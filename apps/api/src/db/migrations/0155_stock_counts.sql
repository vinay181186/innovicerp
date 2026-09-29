-- ============================================================
-- 0155_stock_counts.sql  (ADR-193 phase 2)
--
-- Stock Count — one document for opening stock and for periodic physical
-- counts (ERPNext Stock Reconciliation). Draft → Submitted → Posted | Cancelled.
--   * Each line's system qty is snapshotted when the line is keyed
--     (system_qty_at_count); Submit only fills a missing one.
--   * Approve (a different user) posts counted − system_qty_at_count per line
--     through the single stock writer (source 'stock_count'), so movements
--     made AFTER the count stay real (paper test C2).
-- Lines are soft-deleted when a draft is re-saved; one live line per item.
-- Idempotent. Apply to BOTH the test and the production database.
-- Rollback: DROP TABLE public.stock_count_lines; DROP TABLE public.stock_counts;
-- ============================================================

CREATE TABLE IF NOT EXISTS public.stock_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  code text NOT NULL,
  count_date date NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('opening', 'periodic')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'posted', 'cancelled')),
  remarks text,
  submitted_at timestamptz,
  submitted_by uuid REFERENCES public.users(id),
  approved_at timestamptz,
  approved_by uuid REFERENCES public.users(id),
  approval_reason text,
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES public.users(id),
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES public.users(id),
  deleted_at timestamptz,
  CONSTRAINT stock_counts_posted_has_approver CHECK (status <> 'posted' OR (approved_at IS NOT NULL AND approved_by IS NOT NULL)),
  CONSTRAINT stock_counts_cancel_has_reason CHECK (status <> 'cancelled' OR (cancelled_at IS NOT NULL AND length(btrim(coalesce(cancel_reason, ''))) > 0))
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS stock_counts_company_code_uniq
  ON public.stock_counts (company_id, code) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS stock_counts_company_status_idx
  ON public.stock_counts (company_id, status) WHERE deleted_at IS NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS public.stock_count_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  stock_count_id uuid NOT NULL REFERENCES public.stock_counts(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  item_id uuid NOT NULL REFERENCES public.items(id),
  item_code_text text NOT NULL,
  counted_qty numeric(14,3) NOT NULL CHECK (counted_qty >= 0),
  system_qty_at_count numeric(14,3),
  reason text,
  store_transaction_id uuid REFERENCES public.store_transactions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES public.users(id),
  deleted_at timestamptz
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS stock_count_lines_count_item_uniq
  ON public.stock_count_lines (stock_count_id, item_id) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS stock_count_lines_item_idx
  ON public.stock_count_lines (item_id) WHERE deleted_at IS NULL;
--> statement-breakpoint

ALTER TABLE public.stock_counts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.stock_count_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY stock_counts_company_all ON public.stock_counts
    FOR ALL TO authenticated
    USING (company_id = current_company_id())
    WITH CHECK (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  CREATE POLICY stock_count_lines_company_all ON public.stock_count_lines
    FOR ALL TO authenticated
    USING (company_id = current_company_id())
    WITH CHECK (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
