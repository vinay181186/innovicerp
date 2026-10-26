-- ============================================================
-- 0223_day_log_entries
-- Day Log redesign (owner 2026-10-26): one entry form — Work or Break, Start,
-- Stop (empty = Open), a remark, and work may be against ONE Sales Order or
-- Job Work Order. Entries are added / edited in any order.
--   1. daily_report_lines.sales_order_id / job_work_order_id — the order a
--      work entry was for (at most one of the two; ON DELETE SET NULL).
--   2. The one-running-timer index (work only) becomes one OPEN entry per day,
--      work or break.
-- user_break_times (0222) stays in place, unused. Additive and idempotent.
-- Apply: DB_TARGET=TEST|PROD … tsx src/db/apply-sql.ts (see apply-sql.ts header).
-- ============================================================

ALTER TABLE "daily_report_lines" ADD COLUMN IF NOT EXISTS "sales_order_id" uuid REFERENCES "sales_orders"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "daily_report_lines" ADD COLUMN IF NOT EXISTS "job_work_order_id" uuid REFERENCES "job_work_orders"("id") ON DELETE SET NULL;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "daily_report_lines" ADD CONSTRAINT "daily_report_lines_one_order_chk"
    CHECK ("sales_order_id" IS NULL OR "job_work_order_id" IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "daily_report_lines_so_idx"
  ON "daily_report_lines" ("sales_order_id") WHERE "sales_order_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "daily_report_lines_jwo_idx"
  ON "daily_report_lines" ("job_work_order_id") WHERE "job_work_order_id" IS NOT NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS "daily_report_lines_running_uq";
--> statement-breakpoint
-- One Open entry per day (work or break) — a double add gets a 23505 (409).
CREATE UNIQUE INDEX IF NOT EXISTS "daily_report_lines_open_uq"
  ON "daily_report_lines" ("daily_report_id")
  WHERE "to_time" IS NULL AND "from_time" IS NOT NULL AND "deleted_at" IS NULL;

-- ------------------------------------------------------------
-- DOWN (rollback reference only — NOT run by apply-sql; copy by hand).
-- Loses which SO / JWSO each entry was for.
--
-- DROP INDEX IF EXISTS "daily_report_lines_open_uq";
-- CREATE UNIQUE INDEX IF NOT EXISTS "daily_report_lines_running_uq"
--   ON "daily_report_lines" ("daily_report_id")
--   WHERE "to_time" IS NULL AND "kind" = 'work' AND "deleted_at" IS NULL;
-- DROP INDEX IF EXISTS "daily_report_lines_jwo_idx";
-- DROP INDEX IF EXISTS "daily_report_lines_so_idx";
-- ALTER TABLE "daily_report_lines" DROP CONSTRAINT IF EXISTS "daily_report_lines_one_order_chk";
-- ALTER TABLE "daily_report_lines" DROP COLUMN IF EXISTS "job_work_order_id",
--   DROP COLUMN IF EXISTS "sales_order_id";
-- ------------------------------------------------------------
