-- ============================================================
-- 0225_day_log_edit_approval
-- Day Log simple sheet (owner 2026-10-27, final): a SAVED row is never
-- removed and never changed directly. An edit is staged on the row itself
-- (pending_*) until a Department Admin / Super Admin approves (the pending
-- values become the row's values) or rejects (reject_reason is kept, the
-- row keeps its values). Rules: apps/api/src/modules/day-logs/approvals.ts.
--   1. daily_report_lines.pending_from / pending_to / pending_description /
--      pending_sales_order_id / pending_job_work_order_id — the proposed row.
--   2. pending_at / pending_by — when and who asked (NULL = nothing waiting).
--   3. reject_reason — why the last edit was rejected (cleared by the next).
--   4. A partial index for the approvals list (rows waiting, per company).
-- Additive and idempotent. Apply to BOTH test and production (release script).
-- ============================================================

ALTER TABLE "daily_report_lines" ADD COLUMN IF NOT EXISTS "pending_from" time;
--> statement-breakpoint
ALTER TABLE "daily_report_lines" ADD COLUMN IF NOT EXISTS "pending_to" time;
--> statement-breakpoint
ALTER TABLE "daily_report_lines" ADD COLUMN IF NOT EXISTS "pending_description" text;
--> statement-breakpoint
ALTER TABLE "daily_report_lines" ADD COLUMN IF NOT EXISTS "pending_sales_order_id" uuid REFERENCES "sales_orders"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "daily_report_lines" ADD COLUMN IF NOT EXISTS "pending_job_work_order_id" uuid REFERENCES "job_work_orders"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "daily_report_lines" ADD COLUMN IF NOT EXISTS "pending_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "daily_report_lines" ADD COLUMN IF NOT EXISTS "pending_by" uuid REFERENCES "users"("id");
--> statement-breakpoint
ALTER TABLE "daily_report_lines" ADD COLUMN IF NOT EXISTS "reject_reason" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "daily_report_lines_pending_idx"
  ON "daily_report_lines" ("company_id")
  WHERE "pending_at" IS NOT NULL AND "deleted_at" IS NULL;

-- ------------------------------------------------------------
-- DOWN (rollback reference only — NOT run by apply-sql; copy by hand).
-- Loses every edit still waiting for approval and every reject reason.
--
-- DROP INDEX IF EXISTS "daily_report_lines_pending_idx";
-- ALTER TABLE "daily_report_lines"
--   DROP COLUMN IF EXISTS "reject_reason", DROP COLUMN IF EXISTS "pending_by",
--   DROP COLUMN IF EXISTS "pending_at", DROP COLUMN IF EXISTS "pending_job_work_order_id",
--   DROP COLUMN IF EXISTS "pending_sales_order_id", DROP COLUMN IF EXISTS "pending_description",
--   DROP COLUMN IF EXISTS "pending_to", DROP COLUMN IF EXISTS "pending_from";
-- ------------------------------------------------------------
