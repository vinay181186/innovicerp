-- ============================================================
-- 0257_task_notices_push
-- ADR-309 (owner 2026-11-18) — task pop-ups.
--   task_notices — one row per person per task event (assigned / completed /
--     cancelled). Feeds BOTH the bell and the Windows pop-up (Web Push), so
--     the two can never disagree. push_status tracks the pop-up delivery:
--     pending → sent | failed | off (no laptop switched on / no server keys).
--   push_subscriptions — one row per browser that switched pop-ups on (the
--     browser's PushSubscription: endpoint + keys). An endpoint belongs to
--     one person at a time (same laptop, new login → moved to the new user).
-- Private to the user: RLS lets a user read only their own notices, and read
-- and write only their own subscriptions, inside their own company (like
-- notification_reads, 0236). NOT added to the realtime publication (private
-- data, ADR-254).
-- The API connects as postgres (RLS not enforced at runtime); the service
-- filters company_id AND the user on every query.
-- Additive and idempotent — new tables only, no data change.
-- Apply: DB_TARGET=TEST|PROD … tsx src/db/apply-sql.ts (see apply-sql.ts header).
-- ============================================================

CREATE TABLE IF NOT EXISTS "task_notices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "recipient_id" uuid NOT NULL REFERENCES "users"("id"),
  "task_id" uuid NOT NULL REFERENCES "tasks"("id"),
  "kind" text NOT NULL,
  "actor_id" uuid REFERENCES "users"("id"),
  "event_at" timestamptz NOT NULL,
  "push_status" text NOT NULL DEFAULT 'pending',
  "push_attempts" integer NOT NULL DEFAULT 0,
  "sent_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz,
  "deleted_by" uuid REFERENCES "users"("id"),
  CONSTRAINT "task_notices_kind_chk"
    CHECK ("kind" IN ('task_assigned', 'task_completed', 'task_cancelled')),
  CONSTRAINT "task_notices_push_status_chk"
    CHECK ("push_status" IN ('pending', 'sent', 'failed', 'off')),
  CONSTRAINT "task_notices_push_attempts_chk" CHECK ("push_attempts" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "task_notices_event_uq"
  ON "task_notices" ("task_id", "kind", "recipient_id", "event_at") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_notices_company_recipient_event_idx"
  ON "task_notices" ("company_id", "recipient_id", "event_at" DESC) WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_notices_pending_idx"
  ON "task_notices" ("event_at") WHERE "push_status" = 'pending' AND "deleted_at" IS NULL;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER task_notices_set_updated_at
  BEFORE UPDATE ON public.task_notices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
ALTER TABLE "task_notices" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "task_notices_self_read" ON "task_notices"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id() AND recipient_id = current_user_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "push_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "endpoint" text NOT NULL,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "user_agent" text,
  "last_success_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz,
  "deleted_by" uuid REFERENCES "users"("id"),
  CONSTRAINT "push_subscriptions_endpoint_len" CHECK (char_length("endpoint") BETWEEN 1 AND 1000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_endpoint_uq"
  ON "push_subscriptions" ("endpoint") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_subscriptions_company_user_idx"
  ON "push_subscriptions" ("company_id", "user_id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER push_subscriptions_set_updated_at
  BEFORE UPDATE ON public.push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "push_subscriptions_self_read" ON "push_subscriptions"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id() AND user_id = current_user_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "push_subscriptions_self_write" ON "push_subscriptions"
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
-- DROP TABLE IF EXISTS "task_notices";
-- DROP TABLE IF EXISTS "push_subscriptions";
-- ------------------------------------------------------------
