-- ============================================================
-- 0236_notification_reads
-- ADR-264 (new home dashboard) — the bell's per-item read state.
--   notification_reads — one row per user per notification key: the user
--   marked that one event read (is_read = true) or unread again (false).
--   No row = the old rule: read when the event time is on or before the
--   user's notifications_seen_at (user_ui_settings, ADR-250).
--   note_key is the notification's stable key (activity_log id based,
--   max 128 chars); note_ts is the event time, so "Mark all as read up to
--   <time>" can flip this user's rows by time in one statement.
-- Private to the user: RLS lets a user read and write only their own rows
-- inside their own company (like user_ui_settings, 0189/0190). NOT added to
-- the realtime publication (private data).
-- The API connects as postgres (RLS not enforced at runtime); the service
-- filters company_id AND user_id on every query.
-- Additive and idempotent — a new table only, no data change.
-- Apply: DB_TARGET=TEST|PROD … tsx src/db/apply-sql.ts (see apply-sql.ts header).
-- ============================================================

CREATE TABLE IF NOT EXISTS "notification_reads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "note_key" text NOT NULL,
  "note_ts" timestamptz NOT NULL,
  "is_read" boolean NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz,
  "deleted_by" uuid REFERENCES "users"("id"),
  CONSTRAINT "notification_reads_note_key_len" CHECK (char_length("note_key") BETWEEN 1 AND 128)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "notification_reads_company_user_key_uq"
  ON "notification_reads" ("company_id", "user_id", "note_key") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_reads_company_user_ts_idx"
  ON "notification_reads" ("company_id", "user_id", "note_ts");
--> statement-breakpoint
CREATE OR REPLACE TRIGGER notification_reads_set_updated_at
  BEFORE UPDATE ON public.notification_reads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
ALTER TABLE "notification_reads" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "notification_reads_self_read" ON "notification_reads"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id() AND user_id = current_user_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "notification_reads_self_write" ON "notification_reads"
    FOR ALL TO authenticated
    USING (company_id = current_company_id() AND user_id = current_user_id())
    WITH CHECK (
      company_id = current_company_id()
      AND user_id = current_user_id()
      AND updated_by = current_user_id()
      AND (deleted_by IS NULL OR deleted_by = current_user_id())
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ------------------------------------------------------------
-- DOWN (rollback reference only — NOT run by apply-sql; copy by hand).
--
-- DROP TABLE IF EXISTS "notification_reads";
-- ------------------------------------------------------------
