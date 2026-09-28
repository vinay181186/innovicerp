-- ============================================================
-- 0157_jwso_customer_material.sql  (ADR-194)
--
-- Hardens the customer job-work (JWSO) chain on the CUSTOMER-MATERIAL side,
-- per the JWSO audit (Innovic vs ERPNext). All changes are ADDITIVE (new
-- columns / one new table) so this is safe to run as one batch and idempotent.
-- Apply to BOTH the test and the production database.
--
--   R2 compulsory incoming QC on a Party GRN line (accepted / rejected qty)
--   R4 Party GRN line links to the JWSO line by a real FK (was typed text)
--   R3 Party Store = a separate, zero-value, append-only ledger
--   R5 JW Invoice can be cancelled
--   R6 JWSO line short-close (closed with a recorded shortfall — no new status)
--   R7 spare customer material returned (party_materials.returned_qty)
--
-- Party (customer-owned) material stays OUT of store_transactions (ADR-189);
-- its movements live in the new party_stock_ledger at zero value.
-- ============================================================

-- R2 + R4 — Party GRN line: incoming QC columns + real JWSO-line link ---------
ALTER TABLE public.party_grn_lines
  ADD COLUMN IF NOT EXISTS jw_line_id uuid REFERENCES public.job_work_order_lines(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS accepted_qty integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rejected_qty integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reject_reason text,
  ADD COLUMN IF NOT EXISTS qc_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS qc_at timestamptz;
--> statement-breakpoint
ALTER TABLE public.party_grn_lines DROP CONSTRAINT IF EXISTS party_grn_lines_accepted_nonneg;
ALTER TABLE public.party_grn_lines
  ADD CONSTRAINT party_grn_lines_accepted_nonneg CHECK (accepted_qty >= 0 AND rejected_qty >= 0);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS party_grn_lines_jw_line_idx
  ON public.party_grn_lines (jw_line_id) WHERE deleted_at IS NULL AND jw_line_id IS NOT NULL;
--> statement-breakpoint
-- Backfill the FK from the old typed line-number text (match within the GRN's JWSO).
UPDATE public.party_grn_lines pgl
   SET jw_line_id = jwl.id
  FROM public.party_grn pg, public.job_work_order_lines jwl
 WHERE pgl.party_grn_id = pg.id
   AND jwl.job_work_order_id = pg.job_work_order_id
   AND jwl.line_no::text = NULLIF(btrim(pgl.jw_line_no_text), '')
   AND jwl.deleted_at IS NULL
   AND pgl.jw_line_id IS NULL
   AND pgl.deleted_at IS NULL;
--> statement-breakpoint
-- Grandfather existing receipts: they were booked before QC existed, so treat the
-- whole received qty as accepted.
UPDATE public.party_grn_lines
   SET accepted_qty = received_qty
 WHERE accepted_qty = 0 AND received_qty > 0 AND deleted_at IS NULL;
--> statement-breakpoint

-- R7 — spare customer material returned to the customer -----------------------
ALTER TABLE public.party_materials
  ADD COLUMN IF NOT EXISTS returned_qty integer NOT NULL DEFAULT 0;
--> statement-breakpoint

-- R3 — Party Store: separate, zero-value, append-only ledger ------------------
CREATE TABLE IF NOT EXISTS public.party_stock_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  party_material_id uuid NOT NULL REFERENCES public.party_materials(id),
  jw_line_id uuid REFERENCES public.job_work_order_lines(id) ON DELETE SET NULL,
  -- receive (in) · issue (out to a JC) · consume (out) · return (out to customer)
  -- · reversal (compensating). Customer-owned, so NO value column (zero value).
  movement text NOT NULL CHECK (movement IN ('receive','issue','consume','return','reversal')),
  direction text NOT NULL CHECK (direction IN ('in','out')),
  qty integer NOT NULL CHECK (qty > 0),
  balance_after integer NOT NULL,
  source_doc_type text NOT NULL,
  source_doc_id uuid,
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES public.users(id),
  deleted_at timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS party_stock_ledger_material_idx
  ON public.party_stock_ledger (party_material_id) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS party_stock_ledger_jw_line_idx
  ON public.party_stock_ledger (jw_line_id) WHERE deleted_at IS NULL AND jw_line_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE public.party_stock_ledger ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS party_stock_ledger_company_read ON public.party_stock_ledger;
CREATE POLICY party_stock_ledger_company_read ON public.party_stock_ledger
  FOR SELECT TO authenticated USING (company_id = current_company_id());
--> statement-breakpoint
DROP POLICY IF EXISTS party_stock_ledger_manager_write ON public.party_stock_ledger;
CREATE POLICY party_stock_ledger_manager_write ON public.party_stock_ledger
  FOR ALL TO authenticated
  USING (current_user_role() IN ('admin','manager') AND company_id = current_company_id())
  WITH CHECK (current_user_role() IN ('admin','manager') AND company_id = current_company_id());
--> statement-breakpoint

-- R5 — JW Invoice can be cancelled -------------------------------------------
ALTER TABLE public.jw_invoices
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'issued',
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS cancel_reason text;
--> statement-breakpoint
ALTER TABLE public.jw_invoices DROP CONSTRAINT IF EXISTS jw_invoices_status_check;
ALTER TABLE public.jw_invoices
  ADD CONSTRAINT jw_invoices_status_check CHECK (status IN ('issued','cancelled'));
--> statement-breakpoint

-- R6 — JWSO line short-close (closed with a recorded shortfall; no new status)
ALTER TABLE public.job_work_order_lines
  ADD COLUMN IF NOT EXISTS short_closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS short_closed_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS short_close_reason text;
