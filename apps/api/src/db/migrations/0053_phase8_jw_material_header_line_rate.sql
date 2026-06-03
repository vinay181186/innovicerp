-- ============================================================
-- 0053_phase8_jw_material_header_line_rate
-- JW Master parity (legacy jwHeaderForm L12784, addJW L12885):
--   (a) Move client-material to the HEADER (one CLIENT MATERIAL DETAILS
--       section per JW, matching legacy) — add 4 cols on job_work_orders.
--   (b) Add a per-line `rate` (processing charge per unit) on
--       job_work_order_lines (legacy JW line has Rate ₹ + Amount).
--
-- Non-destructive: the old per-line material columns are LEFT in place
-- (now unused / orphaned — the Drizzle schema no longer maps them).
-- Existing per-line material is copied UP to the header first.
-- All additive + idempotent.
-- ============================================================

-- (a) Header client-material columns.
ALTER TABLE "job_work_orders" ADD COLUMN IF NOT EXISTS "client_material" text;
--> statement-breakpoint
ALTER TABLE "job_work_orders" ADD COLUMN IF NOT EXISTS "client_material_qty" numeric(12,2);
--> statement-breakpoint
ALTER TABLE "job_work_orders" ADD COLUMN IF NOT EXISTS "material_received_date" date;
--> statement-breakpoint
ALTER TABLE "job_work_orders" ADD COLUMN IF NOT EXISTS "material_received_qty" numeric(12,2);
--> statement-breakpoint

-- (b) Per-line processing rate.
ALTER TABLE "job_work_order_lines" ADD COLUMN IF NOT EXISTS "rate" numeric(12,2) NOT NULL DEFAULT 0;
--> statement-breakpoint

-- (c) Copy existing per-line material up to the header (sum qtys, first
--     non-null material, max received date). Only fills headers still blank,
--     so the migration is safe to re-run.
UPDATE "job_work_orders" jw SET
  "client_material_qty"    = agg.client_mat_qty,
  "material_received_qty"  = agg.material_recv_qty,
  "client_material"        = agg.client_material,
  "material_received_date" = agg.material_recv_date
FROM (
  SELECT job_work_order_id,
         SUM(COALESCE(client_material_qty, 0))   AS client_mat_qty,
         SUM(COALESCE(material_received_qty, 0)) AS material_recv_qty,
         MIN(client_material) FILTER (WHERE client_material IS NOT NULL AND client_material <> '') AS client_material,
         MAX(material_received_date)             AS material_recv_date
  FROM "job_work_order_lines"
  WHERE deleted_at IS NULL
  GROUP BY job_work_order_id
) agg
WHERE agg.job_work_order_id = jw.id
  AND jw.client_material IS NULL
  AND jw.client_material_qty IS NULL
  AND jw.material_received_qty IS NULL;
