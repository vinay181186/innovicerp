-- ============================================================
-- 0177_so_line_short_close.sql  (ADR-196)
--
-- Sales Order "Close" (ERPNext: Sales Order → Close, status "Closed" — no
-- further delivery or billing of the remainder). Done per SO LINE, copying the
-- JWSO line short-close (ADR-194 R6, migration 0173): the line's status becomes
-- 'closed' — the shared so_status enum is NOT widened — and three flag columns
-- record that the close left qty undelivered, who did it, when and why.
--
-- ADDITIVE only (three nullable columns + an all-or-none CHECK + a partial
-- index); idempotent; safe on a live table. Apply to BOTH the test and the
-- production database.
-- ============================================================

ALTER TABLE public.sales_order_lines
  ADD COLUMN IF NOT EXISTS short_closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS short_closed_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS short_close_reason text;
--> statement-breakpoint
-- Who / when / why, all or none (same shape as purchase_orders, 0151). No
-- existing row has any of them, so the constraint validates instantly. The
-- status is deliberately NOT part of the CHECK: other writers (the assembly
-- roll-up) move line status between open and closed, and every reader keys
-- the short close off short_closed_at, never off the status.
ALTER TABLE public.sales_order_lines DROP CONSTRAINT IF EXISTS sales_order_lines_short_close_all_or_none;
--> statement-breakpoint
ALTER TABLE public.sales_order_lines
  ADD CONSTRAINT sales_order_lines_short_close_all_or_none CHECK (
    (short_closed_at IS NULL AND short_closed_by IS NULL AND short_close_reason IS NULL)
    OR (short_closed_at IS NOT NULL AND short_closed_by IS NOT NULL
        AND length(btrim(short_close_reason)) > 0)
  );
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sales_order_lines_short_closed_idx
  ON public.sales_order_lines (sales_order_id)
  WHERE deleted_at IS NULL AND short_closed_at IS NOT NULL;
