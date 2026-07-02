-- ============================================================
-- 0058_jw_documents_file_registry
-- JWSO Documents (#8). Adds a Job-Work-Order producer dimension to the unified
-- file_registry (migration 0055) so the JWSO PO-doc upload can register file
-- metadata against a job_work_orders row (JWSOs are NOT in sales_orders).
-- Files themselves live in the `qc-docs` Storage bucket, folder `jw-docs`.
-- Additive — new nullable columns + one index. Idempotent.
-- ============================================================

ALTER TABLE "file_registry"
  ADD COLUMN IF NOT EXISTS "job_work_order_id" uuid REFERENCES "job_work_orders"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "file_registry"
  ADD COLUMN IF NOT EXISTS "jw_code_text" text;
--> statement-breakpoint
ALTER TABLE "file_registry"
  ADD COLUMN IF NOT EXISTS "jw_line_id" uuid REFERENCES "job_work_order_lines"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "file_registry"
  ADD COLUMN IF NOT EXISTS "jw_line_no" integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_registry_company_jw_idx"
  ON "file_registry" ("company_id", "job_work_order_id") WHERE "deleted_at" IS NULL;
