-- ============================================================
-- 0051_phase8_tasks
-- Tasks module (renderTaskBoard L14255 + renderDailyReports L14141).
--   Two screens under the legacy "Tasks" sidebar section:
--     1. Task Board   — taskAllocations  → tasks (+ task_comments)
--     2. Daily Task Reports — dailyReports → daily_reports (+ _lines)
--
-- Legacy stored task.comments[] and report.tasks[] as embedded JSON arrays;
-- CLAUDE.md anti-pattern #1 forbids that, so each child is its own row.
--
-- Distinct from the existing PRODUCTION daily report (renderDailyReport,
-- singular, op-log by machine) — that has no table (it reads op_log).
--
-- All additive + idempotent. No existing data touched.
-- ============================================================

-- ── Enums ──
DO $$ BEGIN
  CREATE TYPE task_status AS ENUM ('todo', 'in_progress', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE task_priority AS ENUM ('high', 'medium', 'low');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE daily_report_line_status AS ENUM ('completed', 'in_progress', 'pending', 'blocked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ── tasks (header) ──
CREATE TABLE IF NOT EXISTS "tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "code" text NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "assigned_to" uuid REFERENCES "users"("id"),
  "assigned_by" uuid REFERENCES "users"("id"),
  "priority" task_priority NOT NULL DEFAULT 'medium',
  "due_date" date NOT NULL,
  "status" task_status NOT NULL DEFAULT 'todo',
  "started_date" date,
  "completed_date" date,
  "linked_ref_type" text,
  "linked_ref_id" text,
  "linked_ref_display" text,
  "linked_ref_nav_page" text,
  "viewed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tasks_company_code_uq"
  ON "tasks" ("company_id", "code") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_company_assignee_idx"
  ON "tasks" ("company_id", "assigned_to") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_company_status_idx"
  ON "tasks" ("company_id", "status") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "tasks_company_read" ON "tasks"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "tasks_self_or_manager_write" ON "tasks"
    FOR ALL TO authenticated
    USING (company_id = current_company_id() AND (assigned_to = current_user_id() OR current_user_role() IN ('admin','manager')))
    WITH CHECK (company_id = current_company_id() AND (assigned_to = current_user_id() OR current_user_role() IN ('admin','manager')));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ── task_comments (rows) ──
CREATE TABLE IF NOT EXISTS "task_comments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "task_id" uuid NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,
  "comment_date" date NOT NULL,
  "text" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_comments_task_idx"
  ON "task_comments" ("task_id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "task_comments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "task_comments_company_read" ON "task_comments"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "task_comments_self_or_manager_write" ON "task_comments"
    FOR ALL TO authenticated
    USING (company_id = current_company_id() AND (created_by = current_user_id() OR current_user_role() IN ('admin','manager')))
    WITH CHECK (company_id = current_company_id() AND (created_by = current_user_id() OR current_user_role() IN ('admin','manager')));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ── daily_reports (header) ──
CREATE TABLE IF NOT EXISTS "daily_reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "report_date" date NOT NULL,
  "shift" shift NOT NULL DEFAULT 'day',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "daily_reports_company_user_idx"
  ON "daily_reports" ("company_id", "user_id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "daily_reports_company_date_idx"
  ON "daily_reports" ("company_id", "report_date") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "daily_reports" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "daily_reports_company_read" ON "daily_reports"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "daily_reports_self_or_manager_write" ON "daily_reports"
    FOR ALL TO authenticated
    USING (company_id = current_company_id() AND (user_id = current_user_id() OR current_user_role() IN ('admin','manager')))
    WITH CHECK (company_id = current_company_id() AND (user_id = current_user_id() OR current_user_role() IN ('admin','manager')));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ── daily_report_lines (rows) ──
CREATE TABLE IF NOT EXISTS "daily_report_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "daily_report_id" uuid NOT NULL REFERENCES "daily_reports"("id") ON DELETE CASCADE,
  "line_no" integer NOT NULL,
  "description" text NOT NULL,
  "ref" text,
  "hours" numeric(6,2) NOT NULL DEFAULT 0,
  "status" daily_report_line_status NOT NULL DEFAULT 'completed',
  "remarks" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "daily_report_lines_line_uq"
  ON "daily_report_lines" ("daily_report_id", "line_no") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "daily_report_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "daily_report_lines_company_read" ON "daily_report_lines"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "daily_report_lines_self_or_manager_write" ON "daily_report_lines"
    FOR ALL TO authenticated
    USING (company_id = current_company_id() AND (created_by = current_user_id() OR current_user_role() IN ('admin','manager')))
    WITH CHECK (company_id = current_company_id() AND (created_by = current_user_id() OR current_user_role() IN ('admin','manager')));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
