-- ============================================================
-- 0061_jw_gst_percent
-- Add a GST % field to the Job Work Order header (job_work_orders.gst_percent),
-- for parity with sales_orders.gst_percent. Drives the subtotal / GST / grand
-- totals on the JWSO form. Additive, idempotent — existing rows default to 18.
-- ============================================================

ALTER TABLE "job_work_orders"
  ADD COLUMN IF NOT EXISTS "gst_percent" numeric(5, 2) NOT NULL DEFAULT 18;
