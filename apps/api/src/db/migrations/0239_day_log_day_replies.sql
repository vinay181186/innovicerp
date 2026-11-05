-- Day Log Pending Entries (owner 2026-11-05).
--
--   daily_report_day_replies — a Super Admin's reply on a person's BLANK day
--     (the day has no line to hang a daily_report_line_replies row on). Hangs on
--     the day header. seen_at = when the owner first opened that date since the
--     reply was sent / last edited.
--   tasks_day_log_date_open_uq — one OPEN task per day header for those replies.
--     The writer (tasks/day-log-task.ts) runs under the day header lock; this
--     index is the backstop.
--
-- PRIVACY: same as 0228. Read by the API only (BYPASSRLS): RLS is ON with a
-- deny-all SELECT policy for client roles, and the table is not published to
-- Realtime. The screens refresh through the daily_reports header bump.
--
-- Additive only.

CREATE TABLE IF NOT EXISTS "daily_report_day_replies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "daily_report_id" uuid NOT NULL REFERENCES "daily_reports"("id"),
  "body" text NOT NULL,
  "sent_at" timestamptz NOT NULL DEFAULT now(),
  "edited_at" timestamptz,
  "seen_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz,
  "deleted_by" uuid REFERENCES "users"("id")
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "daily_report_day_replies" ADD CONSTRAINT "dl_day_replies_body_chk"
    CHECK (length(btrim("body")) > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dl_day_replies_company_report_idx"
  ON "daily_report_day_replies" ("company_id", "daily_report_id", "sent_at")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dl_day_replies_unseen_idx"
  ON "daily_report_day_replies" ("company_id", "daily_report_id")
  WHERE "seen_at" IS NULL AND "deleted_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "daily_report_day_replies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "dl_day_replies_no_client_read" ON "daily_report_day_replies"
    FOR SELECT TO authenticated
    USING (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tasks_day_log_date_open_uq"
  ON "tasks" ("company_id", "linked_ref_id")
  WHERE "linked_ref_type" = 'day_log_date' AND "deleted_at" IS NULL
    AND "status" IN ('todo', 'in_progress');
