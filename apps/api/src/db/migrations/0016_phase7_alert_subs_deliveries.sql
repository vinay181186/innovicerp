-- ============================================================
-- 0016_phase7_alert_subs_deliveries
-- T-041d Phase B (slice 6) per ADR-024.
--   1. current_user_id() SQL helper (extracts `sub` from JWT claims) —
--      mirrors current_company_id() / current_user_role() helpers from
--      0001_post_init. Used by alert_subscriptions self-write policy.
--   2. alert_subscriptions — per-user per-rule email opt-in. RLS allows
--      any company member to read, the row's own user OR admin/manager to
--      write.
--   3. alert_deliveries — append-only audit log of dispatch attempts. The
--      (code, user_id, window_start, channel) unique key is the dedup key
--      the worker checks before sending.
-- Apply via apply-sql.ts (the journal-orphan workaround per RUNBOOK
-- "Database — Migrations").
-- ============================================================

CREATE OR REPLACE FUNCTION public.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid
$$;
--> statement-breakpoint

-- ----- alert_subscriptions --------------------------------------------------

CREATE TABLE IF NOT EXISTS "alert_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"code" text NOT NULL,
	"channel" text NOT NULL DEFAULT 'email',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_subscriptions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "alert_subscriptions" ADD CONSTRAINT "alert_subs_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alert_subscriptions" ADD CONSTRAINT "alert_subs_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alert_subscriptions" ADD CONSTRAINT "alert_subs_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alert_subscriptions" ADD CONSTRAINT "alert_subs_updated_by_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "alert_subs_company_user_code_channel_uniq"
  ON "alert_subscriptions" USING btree ("company_id","user_id","code","channel");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alert_subs_company_code_idx"
  ON "alert_subscriptions" USING btree ("company_id","code");
--> statement-breakpoint

CREATE POLICY "alert_subs_company_read"
  ON "alert_subscriptions" AS PERMISSIVE
  FOR SELECT TO "authenticated"
  USING (company_id = current_company_id());
--> statement-breakpoint
CREATE POLICY "alert_subs_self_or_manager_write"
  ON "alert_subscriptions" AS PERMISSIVE
  FOR ALL TO "authenticated"
  USING (
    company_id = current_company_id()
    AND (user_id = current_user_id() OR current_user_role() IN ('admin','manager'))
  )
  WITH CHECK (
    company_id = current_company_id()
    AND (user_id = current_user_id() OR current_user_role() IN ('admin','manager'))
  );
--> statement-breakpoint

CREATE OR REPLACE TRIGGER alert_subscriptions_set_updated_at
  BEFORE UPDATE ON public.alert_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint

-- ----- alert_deliveries -----------------------------------------------------
-- Append-only. No updated_at / no soft-delete (same shape as activity_log).
-- created_by nullable so the worker can write rows for system-scheduled
-- digests that lack a user actor.

CREATE TABLE IF NOT EXISTS "alert_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"code" text NOT NULL,
	"channel" text NOT NULL DEFAULT 'email',
	"window_start" timestamp with time zone NOT NULL,
	"message_id" text NOT NULL,
	"record_count" integer NOT NULL DEFAULT 0,
	"real_send" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "alert_deliveries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliv_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliv_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliv_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- The idempotency key the worker uses: (code, user_id, window_start, channel).
-- A second insert with the same tuple raises unique_violation; worker treats
-- that as "already dispatched in this window" and skips Resend.
CREATE UNIQUE INDEX IF NOT EXISTS "alert_deliv_idem_uniq"
  ON "alert_deliveries" USING btree ("code","user_id","window_start","channel");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alert_deliv_company_created_idx"
  ON "alert_deliveries" USING btree ("company_id","created_at" DESC);
--> statement-breakpoint

CREATE POLICY "alert_deliv_manager_read"
  ON "alert_deliveries" AS PERMISSIVE
  FOR SELECT TO "authenticated"
  USING (
    company_id = current_company_id()
    AND current_user_role() IN ('admin','manager')
  );
--> statement-breakpoint
-- Self-insert: a subscriber's worker context inserts its own delivery row.
CREATE POLICY "alert_deliv_self_insert"
  ON "alert_deliveries" AS PERMISSIVE
  FOR INSERT TO "authenticated"
  WITH CHECK (
    company_id = current_company_id()
    AND user_id = current_user_id()
  );
