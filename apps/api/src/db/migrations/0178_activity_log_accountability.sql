-- ============================================================
-- 0178_activity_log_accountability.sql  (ADR-197)
--
-- Accountability foundation: per-document history, before -> after, deleted_by.
--   1. activity_log gains the document id, line / op location, qty moved,
--      the before -> after list, the reason, the operator and the user's name.
--   2. Two indexes serve the per-document History tab.
--   3. Missing "who" columns: PR rejected, OSP DC issued / received /
--      cancelled, NC disposition by a real user.
--   4. deleted_by on EVERY table that has deleted_at.
--
-- ADDITIVE only (nullable columns, indexes, one CHECK on a new column);
-- idempotent; safe on live tables. Apply to BOTH the test and the
-- production database.
-- ============================================================

ALTER TABLE public.activity_log
  ADD COLUMN IF NOT EXISTS entity_id uuid,
  ADD COLUMN IF NOT EXISTS line_ref text,
  ADD COLUMN IF NOT EXISTS op_ref text,
  ADD COLUMN IF NOT EXISTS qty numeric(14,3),
  ADD COLUMN IF NOT EXISTS changes jsonb,
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS operator_name text,
  ADD COLUMN IF NOT EXISTS user_full_name text;
--> statement-breakpoint
-- changes is a JSON array of {field,label,before,after} or NULL.
ALTER TABLE public.activity_log DROP CONSTRAINT IF EXISTS activity_log_changes_is_array;
--> statement-breakpoint
ALTER TABLE public.activity_log
  ADD CONSTRAINT activity_log_changes_is_array
  CHECK (changes IS NULL OR jsonb_typeof(changes) = 'array');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS activity_log_company_entity_doc_idx
  ON public.activity_log (company_id, entity, entity_id, ts DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS activity_log_company_ref_idx
  ON public.activity_log (company_id, ref_id);
--> statement-breakpoint
-- PR reject: who / when / why (same three columns as purchase_orders).
ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS rejected_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text;
--> statement-breakpoint
-- OSP DC: issued (sent to vendor), received back, cancelled.
ALTER TABLE public.delivery_challans
  ADD COLUMN IF NOT EXISTS issued_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS issued_at timestamptz,
  ADD COLUMN IF NOT EXISTS received_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS received_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
--> statement-breakpoint
-- NC disposition by a real user. disposition_by_text stays as the snapshot
-- fallback (NAMING: read disposition_by ?? disposition_by_text).
ALTER TABLE public.nc_register
  ADD COLUMN IF NOT EXISTS disposition_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS disposition_at timestamptz;
--> statement-breakpoint
-- deleted_by on every base table in public that has deleted_at.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables tb
      ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'deleted_at'
      AND tb.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES public.users(id)',
      t.table_name
    );
  END LOOP;
END
$$;
