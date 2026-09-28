-- ============================================================
-- 0157_issue_slip_lines.sql  (ADR-193 phase 3b)
--
-- An Item Issue becomes a SLIP (store_issues = header) with LINES, issued
-- against a Job Card, an assembly (Equipment) SO, or for general use:
--   store_issues      += issue_against, sales_order_id, issued_to_operator_id,
--                        department; the old single-item columns (item_id,
--                        item_code_text, item_name, qty, store_transaction_id)
--                        become nullable and are no longer written
--   store_issue_lines  one row per item (qty numeric(14,3), ledger link)
--   store_issue_returns leftovers put back (any qty up to what is unused)
-- Existing slips are copied into one line each (3 on TEST, 0 on PROD).
-- Idempotent. Apply to BOTH the test and the production database.
-- Rollback: DROP TABLE store_issue_returns, store_issue_lines;
--           ALTER TABLE store_issues DROP COLUMN issue_against, sales_order_id,
--             issued_to_operator_id, department;  (old columns still hold the
--             pre-0157 rows; re-add NOT NULL only if no header-only rows exist)
-- ============================================================

ALTER TABLE public.store_issues
  ADD COLUMN IF NOT EXISTS issue_against text NOT NULL DEFAULT 'general'
    CHECK (issue_against IN ('job_card', 'assembly_so', 'general')),
  ADD COLUMN IF NOT EXISTS sales_order_id uuid REFERENCES public.sales_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS issued_to_operator_id uuid REFERENCES public.operators(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS department text;
--> statement-breakpoint

ALTER TABLE public.store_issues
  ALTER COLUMN item_name DROP NOT NULL,
  ALTER COLUMN qty DROP NOT NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.store_issue_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  issue_id uuid NOT NULL REFERENCES public.store_issues(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  item_id uuid NOT NULL REFERENCES public.items(id),
  item_code_text text NOT NULL,
  qty numeric(14,3) NOT NULL CHECK (qty > 0),
  store_transaction_id uuid REFERENCES public.store_transactions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES public.users(id),
  deleted_at timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS store_issue_lines_issue_idx ON public.store_issue_lines (issue_id) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS store_issue_lines_item_idx ON public.store_issue_lines (item_id) WHERE deleted_at IS NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.store_issue_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  issue_line_id uuid NOT NULL REFERENCES public.store_issue_lines(id) ON DELETE CASCADE,
  return_date date NOT NULL,
  qty numeric(14,3) NOT NULL CHECK (qty > 0),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  store_transaction_id uuid REFERENCES public.store_transactions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES public.users(id),
  deleted_at timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS store_issue_returns_line_idx ON public.store_issue_returns (issue_line_id) WHERE deleted_at IS NULL;
--> statement-breakpoint

ALTER TABLE public.store_issue_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.store_issue_returns ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY store_issue_lines_company_all ON public.store_issue_lines
    FOR ALL TO authenticated
    USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY store_issue_returns_company_all ON public.store_issue_returns
    FOR ALL TO authenticated
    USING (company_id = current_company_id()) WITH CHECK (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- Backfill: every pre-0157 slip (one item) becomes a slip with one line.
INSERT INTO public.store_issue_lines
  (company_id, issue_id, line_no, item_id, item_code_text, qty, store_transaction_id, created_at, created_by, updated_at, updated_by)
SELECT si.company_id, si.id, 1, si.item_id, COALESCE(si.item_code_text, i.code), si.qty, si.store_transaction_id,
       si.created_at, si.created_by, si.updated_at, si.updated_by
FROM public.store_issues si
JOIN public.items i ON i.id = si.item_id
WHERE si.item_id IS NOT NULL AND si.qty IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.store_issue_lines l WHERE l.issue_id = si.id);
--> statement-breakpoint
UPDATE public.store_issues SET issue_against = 'job_card'
WHERE job_card_id IS NOT NULL AND issue_against = 'general';
