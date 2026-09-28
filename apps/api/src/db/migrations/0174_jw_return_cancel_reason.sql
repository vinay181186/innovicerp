-- ============================================================
-- 0174_jw_return_cancel_reason.sql  (ADR-194, R10)
-- (renumbered from 0158 — the store-redesign branch already owns 0157/0158 on `test`)
--
-- The JW Return Challan cancel now asks the user for a reason (like the JW
-- Invoice cancel does). Give the challan somewhere to record it, symmetric with
-- the jw_invoices cancel columns added in 0173. All ADDITIVE.
-- Apply to BOTH the test and the production database.
-- ============================================================

ALTER TABLE public.jw_return_challans
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS cancel_reason text;
