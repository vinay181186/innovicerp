-- ============================================================
-- 0194_jw_line_returned_cap.sql  (ADR-203 qty audit #7)
-- A JWSO line can never record more finished parts returned to the customer
-- than it ordered. The JW Return service already caps it; this makes the
-- database refuse it too. Idempotent. Apply to BOTH databases.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.job_work_order_lines WHERE returned_qty > order_qty) THEN
    RAISE EXCEPTION '0194: a JWSO line has returned_qty > order_qty — fix it before this rule can be added';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE public.job_work_order_lines DROP CONSTRAINT IF EXISTS job_work_order_lines_returned_cap;
ALTER TABLE public.job_work_order_lines
  ADD CONSTRAINT job_work_order_lines_returned_cap CHECK (returned_qty <= order_qty);
