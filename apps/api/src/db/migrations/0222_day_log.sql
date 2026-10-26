-- ============================================================
-- 0222_day_log
-- Day Log (owner 2026-10-26) — each user logs their working day as From–To
-- entries. Built ON the Daily Task Report tables from 0051:
--   daily_reports       = the day   (one per user per date)
--   daily_report_lines  = its entries (work, or a break copied from the
--                         user's break template when the day is opened)
--   1. enums day_log_status ('open','submitted','leave') and
--      day_log_entry_kind ('work','break').
--   2. daily_reports: day status, the work window, submit / reopen / leave
--      stamps, and ONE live day per user per date (partial unique index —
--      the opening insert's ON CONFLICT target).
--   3. daily_report_lines: kind, From / To (To NULL = timer running), the
--      linked task, the stop note. One running timer per day (partial unique
--      index). `hours` stays and is written only by the server from From/To.
--   4. user_break_times — each user's own break template.
--   5. company_holidays — days that are not working days.
--   6. daily_reports joins the Realtime publication (same guard as 0217).
-- PROD and TEST held 0 rows in daily_reports / daily_report_lines when this
-- was written, so the new NOT NULL defaults touch nothing. Additive and
-- idempotent.
-- Apply: DB_TARGET=TEST|PROD … tsx src/db/apply-sql.ts (see apply-sql.ts header).
-- ============================================================

DO $$ BEGIN
  CREATE TYPE day_log_status AS ENUM ('open', 'submitted', 'leave');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE day_log_entry_kind AS ENUM ('work', 'break');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ── daily_reports (the day) ──
ALTER TABLE "daily_reports" ADD COLUMN IF NOT EXISTS "day_status" day_log_status NOT NULL DEFAULT 'open';
--> statement-breakpoint
ALTER TABLE "daily_reports" ADD COLUMN IF NOT EXISTS "work_from" time NOT NULL DEFAULT '09:00';
--> statement-breakpoint
ALTER TABLE "daily_reports" ADD COLUMN IF NOT EXISTS "work_to" time NOT NULL DEFAULT '18:00';
--> statement-breakpoint
ALTER TABLE "daily_reports" ADD COLUMN IF NOT EXISTS "submitted_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "daily_reports" ADD COLUMN IF NOT EXISTS "submitted_by" uuid REFERENCES "users"("id");
--> statement-breakpoint
ALTER TABLE "daily_reports" ADD COLUMN IF NOT EXISTS "reopened_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "daily_reports" ADD COLUMN IF NOT EXISTS "reopened_by" uuid REFERENCES "users"("id");
--> statement-breakpoint
ALTER TABLE "daily_reports" ADD COLUMN IF NOT EXISTS "reopen_reason" text;
--> statement-breakpoint
ALTER TABLE "daily_reports" ADD COLUMN IF NOT EXISTS "leave_reason" text;
--> statement-breakpoint
-- One live day per user per date: the opening insert's ON CONFLICT target,
-- so two first entries at once open ONE day.
CREATE UNIQUE INDEX IF NOT EXISTS "daily_reports_user_day_uq"
  ON "daily_reports" ("company_id", "user_id", "report_date") WHERE "deleted_at" IS NULL;
--> statement-breakpoint

-- ── daily_report_lines (the entries) ──
ALTER TABLE "daily_report_lines" ADD COLUMN IF NOT EXISTS "kind" day_log_entry_kind NOT NULL DEFAULT 'work';
--> statement-breakpoint
ALTER TABLE "daily_report_lines" ADD COLUMN IF NOT EXISTS "from_time" time;
--> statement-breakpoint
ALTER TABLE "daily_report_lines" ADD COLUMN IF NOT EXISTS "to_time" time;
--> statement-breakpoint
ALTER TABLE "daily_report_lines" ADD COLUMN IF NOT EXISTS "task_id" uuid REFERENCES "tasks"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "daily_report_lines" ADD COLUMN IF NOT EXISTS "stop_note" text;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "daily_report_lines" ADD CONSTRAINT "daily_report_lines_from_to_chk"
    CHECK ("to_time" IS NULL OR "from_time" IS NULL OR "to_time" > "from_time");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
-- One running timer per day — a double Start gets a 23505 here (409).
CREATE UNIQUE INDEX IF NOT EXISTS "daily_report_lines_running_uq"
  ON "daily_report_lines" ("daily_report_id")
  WHERE "to_time" IS NULL AND "kind" = 'work' AND "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "daily_report_lines_report_idx"
  ON "daily_report_lines" ("daily_report_id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "daily_report_lines_task_idx"
  ON "daily_report_lines" ("task_id");
--> statement-breakpoint

-- ── user_break_times (each user's break template) ──
CREATE TABLE IF NOT EXISTS "user_break_times" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "name" text NOT NULL,
  "from_time" time NOT NULL,
  "to_time" time NOT NULL,
  "sort_no" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz,
  "deleted_by" uuid REFERENCES "users"("id")
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "user_break_times" ADD CONSTRAINT "user_break_times_from_to_chk"
    CHECK ("to_time" > "from_time");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_break_times_user_idx"
  ON "user_break_times" ("company_id", "user_id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "user_break_times" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "user_break_times_company_read" ON "user_break_times"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "user_break_times_self_or_manager_write" ON "user_break_times"
    FOR ALL TO authenticated
    USING (company_id = current_company_id() AND (user_id = current_user_id() OR current_user_role() IN ('admin','manager')))
    WITH CHECK (company_id = current_company_id() AND (user_id = current_user_id() OR current_user_role() IN ('admin','manager')));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ── company_holidays ──
CREATE TABLE IF NOT EXISTS "company_holidays" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "holiday_date" date NOT NULL,
  "name" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz,
  "deleted_by" uuid REFERENCES "users"("id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "company_holidays_day_uq"
  ON "company_holidays" ("company_id", "holiday_date") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "company_holidays" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "company_holidays_company_read" ON "company_holidays"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
-- The API (BYPASSRLS, 0180) checks Super Admin itself; this only fences
-- other companies and non-admins on a direct connection.
DO $$ BEGIN
  CREATE POLICY "company_holidays_admin_write" ON "company_holidays"
    FOR ALL TO authenticated
    USING (company_id = current_company_id() AND current_user_role() = 'admin')
    WITH CHECK (company_id = current_company_id() AND current_user_role() = 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- Realtime (ADR-230): same guards as 0217 — no-op without the publication,
-- skips an already-published table. packages/shared LIVE_TABLES lists
-- daily_reports; every Day Log write bumps the header's updated_at.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE NOTICE 'realtime: no supabase_realtime publication on this database — nothing to do';
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'daily_reports'
  ) THEN
    RAISE NOTICE 'realtime: daily_reports already published';
    RETURN;
  END IF;
  ALTER PUBLICATION supabase_realtime ADD TABLE public.daily_reports;
  RAISE NOTICE 'realtime: added daily_reports';
END $$;

-- ------------------------------------------------------------
-- DOWN (rollback reference only — NOT run by apply-sql; copy by hand).
-- Destroys every Day Log entry time, break template and holiday.
--
-- ALTER PUBLICATION supabase_realtime DROP TABLE public.daily_reports;
-- DROP TABLE IF EXISTS "company_holidays";
-- DROP TABLE IF EXISTS "user_break_times";
-- DROP INDEX IF EXISTS "daily_report_lines_task_idx";
-- DROP INDEX IF EXISTS "daily_report_lines_report_idx";
-- DROP INDEX IF EXISTS "daily_report_lines_running_uq";
-- ALTER TABLE "daily_report_lines" DROP CONSTRAINT IF EXISTS "daily_report_lines_from_to_chk";
-- ALTER TABLE "daily_report_lines" DROP COLUMN IF EXISTS "stop_note",
--   DROP COLUMN IF EXISTS "task_id", DROP COLUMN IF EXISTS "to_time",
--   DROP COLUMN IF EXISTS "from_time", DROP COLUMN IF EXISTS "kind";
-- DROP INDEX IF EXISTS "daily_reports_user_day_uq";
-- ALTER TABLE "daily_reports" DROP COLUMN IF EXISTS "leave_reason",
--   DROP COLUMN IF EXISTS "reopen_reason", DROP COLUMN IF EXISTS "reopened_by",
--   DROP COLUMN IF EXISTS "reopened_at", DROP COLUMN IF EXISTS "submitted_by",
--   DROP COLUMN IF EXISTS "submitted_at", DROP COLUMN IF EXISTS "work_to",
--   DROP COLUMN IF EXISTS "work_from", DROP COLUMN IF EXISTS "day_status";
-- DROP TYPE IF EXISTS day_log_entry_kind;
-- DROP TYPE IF EXISTS day_log_status;
-- ------------------------------------------------------------
