-- ============================================================
-- 0194_jw_line_returned_cap.sql  (ADR-203 qty audit #7)
-- A JWSO line can never record more finished parts returned to the customer
-- than it ordered. The JW Return service already caps it; this makes the
-- database refuse it too. Idempotent. Apply to BOTH databases.
-- ============================================================

ALTER TABLE public.job_work_order_lines DROP CONSTRAINT IF EXISTS job_work_order_lines_returned_cap;
ALTER TABLE public.job_work_order_lines
  ADD CONSTRAINT job_work_order_lines_returned_cap CHECK (returned_qty <= order_qty);
