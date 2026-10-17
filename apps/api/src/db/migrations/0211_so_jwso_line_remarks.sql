-- ADR-236 — optional "Remarks" on each Sales Order line and each Job Work Sales
-- Order line: free text about that one line. The whole-order note already lives
-- in sales_orders.remarks / job_work_orders.remarks and is now labelled
-- "SO Remarks" / "JWSO Remarks" (the GRN split — GRN Remarks vs line Remarks).
--
-- Optional, nullable, no backfill. Limit (500) and trim live in the shared input
-- schema (packages/shared/src/lib/line-remarks.ts). Additive only.
--
-- ROLLBACK:
--   ALTER TABLE public.sales_order_lines DROP COLUMN remarks;
--   ALTER TABLE public.job_work_order_lines DROP COLUMN remarks;

ALTER TABLE public.sales_order_lines
  ADD COLUMN IF NOT EXISTS remarks text;
--> statement-breakpoint
ALTER TABLE public.job_work_order_lines
  ADD COLUMN IF NOT EXISTS remarks text;
