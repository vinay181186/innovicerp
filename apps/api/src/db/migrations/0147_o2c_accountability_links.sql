-- ============================================================
-- 0147_o2c_accountability_links.sql  (ADR-185)
--
-- Three accountability gaps from the order-to-cash re-audit (2026-09-26):
--
--   (a) Raw material issued against a Job Card / Production Order was linked
--       only by the typed ref_no. store_issues gains job_card_id and
--       production_order_id (FK, ON DELETE SET NULL); existing rows are
--       backfilled where ref_no names a live card or order. The service sets
--       both on every new issue.
--   (b) The stock ledger was append-only by convention only. A trigger now
--       refuses UPDATE and DELETE on store_transactions. A correction is a new
--       opposite row, as every reversal in the app already writes. A
--       deliberate maintenance session can lift it for itself with
--       SET LOCAL innovic.ledger_maintenance = 'on'.
--   (c) NOT done here: QC logs entered through Op Entry before this change
--       carry no qc_user_id. op_log is append-only (0097 trigger, ADR-127),
--       and 0115 deliberately left old rows alone; they stay accountable
--       through created_by. The service now records the logged-in user on
--       every new QC log.
--
-- Idempotent (IF NOT EXISTS / CREATE OR REPLACE / NULL-only updates).
-- Apply to BOTH the test and the production database.
-- Rollback: DROP TRIGGER store_transactions_immutable ON public.store_transactions;
--           ALTER TABLE public.store_issues DROP COLUMN job_card_id, DROP COLUMN production_order_id;
-- ============================================================

ALTER TABLE public.store_issues
  ADD COLUMN IF NOT EXISTS job_card_id uuid
    REFERENCES public.job_cards (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS production_order_id uuid
    REFERENCES public.production_orders (id) ON DELETE SET NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS store_issues_job_card_idx
  ON public.store_issues (job_card_id) WHERE job_card_id IS NOT NULL;
--> statement-breakpoint

UPDATE public.store_issues si
   SET job_card_id = jc.id,
       production_order_id = jc.production_order_id
  FROM public.job_cards jc
 WHERE si.job_card_id IS NULL
   AND si.ref_no IS NOT NULL
   AND jc.company_id = si.company_id
   AND jc.deleted_at IS NULL
   AND si.ref_type IN ('Job Card', 'Production')
   AND jc.code = btrim(si.ref_no);
--> statement-breakpoint

UPDATE public.store_issues si
   SET production_order_id = po.id,
       job_card_id = COALESCE(si.job_card_id, po.job_card_id)
  FROM public.production_orders po
 WHERE si.production_order_id IS NULL
   AND si.ref_no IS NOT NULL
   AND po.company_id = si.company_id
   AND po.deleted_at IS NULL
   AND si.ref_type IN ('Job Card', 'Production')
   AND po.code = btrim(si.ref_no);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.store_transactions_refuse_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Two deliberate exits: a maintenance session that asked for it, and the
  -- API test harness (its connections carry this application_name, set only
  -- under NODE_ENV=test) cleaning up the rows it created.
  IF COALESCE(current_setting('innovic.ledger_maintenance', true), '') = 'on'
     OR COALESCE(current_setting('application_name', true), '') = 'innovic-test-harness' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'The stock ledger cannot be % — post an opposite entry instead (ADR-185).',
    CASE TG_OP WHEN 'UPDATE' THEN 'edited' ELSE 'deleted' END
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS store_transactions_immutable ON public.store_transactions;
--> statement-breakpoint

CREATE TRIGGER store_transactions_immutable
  BEFORE UPDATE OR DELETE ON public.store_transactions
  FOR EACH ROW EXECUTE FUNCTION public.store_transactions_refuse_change();
