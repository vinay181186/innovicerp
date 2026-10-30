-- ============================================================
-- 0230_day_log_team_mates
-- Day Log "Teams Config" (owner 2026-10-30). A Super Admin pairs two people;
-- the pair is TWO-WAY: each sees the other's saved Day Log entries,
-- read-only (no Entry Rev, no replies, no edit / approve).
--   1. day_log_team_mates — ONE row per pair, the two user ids stored sorted
--      (user_low_id < user_high_id), so one row covers both directions and
--      a pair cannot be stored twice (partial unique on the live rows — the
--      add's ON CONFLICT target).
--   2. RLS on; a person reads only the pairs they are in (who-sees-whom is
--      not company-wide data — PostgREST / Realtime deliver only those rows);
--      no client write policy — the API (BYPASSRLS, 0180) checks Super Admin.
--   3. Joins the Realtime publication (same guard as 0217 / 0222).
-- New table, no data touched. Additive and idempotent.
-- Apply: DB_TARGET=TEST|PROD … tsx src/db/apply-sql.ts (see apply-sql.ts header).
-- ============================================================

CREATE TABLE IF NOT EXISTS "day_log_team_mates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "user_low_id" uuid NOT NULL REFERENCES "users"("id"),
  "user_high_id" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz,
  "deleted_by" uuid REFERENCES "users"("id")
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "day_log_team_mates" ADD CONSTRAINT "day_log_team_mates_sorted_chk"
    CHECK ("user_low_id" < "user_high_id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
-- One live row per pair: the add's ON CONFLICT target (a double add → 409).
CREATE UNIQUE INDEX IF NOT EXISTS "day_log_team_mates_pair_uq"
  ON "day_log_team_mates" ("company_id", "user_low_id", "user_high_id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
-- The low side is covered by the unique index above.
CREATE INDEX IF NOT EXISTS "day_log_team_mates_high_idx"
  ON "day_log_team_mates" ("company_id", "user_high_id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "day_log_team_mates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- An early TEST copy of this file had a company-wide read; it goes.
DROP POLICY IF EXISTS "day_log_team_mates_company_read" ON "day_log_team_mates";
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "day_log_team_mates_own_read" ON "day_log_team_mates"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id()
      AND (user_low_id = current_user_id() OR user_high_id = current_user_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- Realtime (ADR-230): same guards as 0217 — no-op without the publication,
-- skips an already-published table. packages/shared LIVE_TABLES lists
-- day_log_team_mates.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE NOTICE 'realtime: no supabase_realtime publication on this database — nothing to do';
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'day_log_team_mates'
  ) THEN
    RAISE NOTICE 'realtime: day_log_team_mates already published';
    RETURN;
  END IF;
  ALTER PUBLICATION supabase_realtime ADD TABLE public.day_log_team_mates;
  RAISE NOTICE 'realtime: added day_log_team_mates';
END $$;

-- ------------------------------------------------------------
-- DOWN (rollback reference only — NOT run by apply-sql; copy by hand).
-- Destroys every Teams Config pair.
--
-- ALTER PUBLICATION supabase_realtime DROP TABLE public.day_log_team_mates;
-- DROP TABLE IF EXISTS "day_log_team_mates";
-- ------------------------------------------------------------
