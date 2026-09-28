-- ============================================================
-- 0158_jw_return_cancel_reason.sql  (ADR-194, R10)
--
-- The JW Return Challan cancel now asks the user for a reason (like the JW
-- Invoice cancel does). Give the challan somewhere to record it, symmetric with
-- the jw_invoices cancel columns added in 0157. All ADDITIVE.
-- Apply to BOTH the test and the production database.
-- ============================================================

ALTER TABLE public.jw_return_challans
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS cancel_reason text;
