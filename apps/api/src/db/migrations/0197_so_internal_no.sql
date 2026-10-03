-- ============================================================
-- 0197_so_internal_no.sql  (ADR-207)
-- "Internal SO No." on Sales Orders: the office's own number (e.g. SO-2401),
-- typed by the user, beside the system SO No. (IN-SO-#####).
--   - sales_orders.internal_so_no text NULL. Required on create by the API;
--     SOs made before this migration stay NULL.
--   - Unique per company, case-insensitive, among live (non-deleted) SOs.
-- Job Work orders are untouched.
-- Idempotent. Apply to BOTH databases (PROD + TEST).
-- Rollback: DROP INDEX IF EXISTS public.sales_orders_company_internal_so_no_uniq;
--           ALTER TABLE public.sales_orders DROP COLUMN IF EXISTS internal_so_no;
-- ============================================================

ALTER TABLE public.sales_orders
  ADD COLUMN IF NOT EXISTS internal_so_no text NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS sales_orders_company_internal_so_no_uniq
  ON public.sales_orders (company_id, lower(internal_so_no))
  WHERE deleted_at IS NULL AND internal_so_no IS NOT NULL;
