-- 0231 — Teams Config is ONE-WAY (owner 2026-10-31, ADR-258 corrected).
-- "User Aashvi, team mate Parth → Aashvi sees Parth's Day Log. Parth sees
-- Aashvi only if Parth → Aashvi is set too." 0230 stored a pair with no
-- direction (ids sorted user_low_id / user_high_id) and showed it both ways.
--
--   1. ADD user_id (who SEES) and mate_id (who is seen). Additive on purpose:
--      the API still running 0230 code keeps reading user_low_id /
--      user_high_id until the new build is live (no broken window). A later
--      migration drops the two old columns.
--   2. Direction of rows saved under 0230: the CREATE activity row names the
--      picked User first ("Teams Config: <User> and <Mate> see each other's
--      Day Log"), matched with starts_with (names are never patterns). A row
--      whose direction cannot be told (no activity, same name both sides, a
--      rename since) is REMOVED (soft, deleted_by = whoever created it) —
--      never doubled — so nobody gains sight the Super Admin did not give;
--      the Super Admin re-adds it the right way round.
--   3. CHECK user_id <> mate_id; ONE live row per (company, user, mate);
--      index on mate_id (FK). The old sorted CHECK / indexes go.
--   4. Read rule: a client sees only rows where it is the User.
-- Idempotent: step 1–2 run only while user_id is missing.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'day_log_team_mates'
                   AND column_name = 'user_id') THEN
    ALTER TABLE "day_log_team_mates" ADD COLUMN "user_id" uuid REFERENCES "users"("id");
    ALTER TABLE "day_log_team_mates" ADD COLUMN "mate_id" uuid REFERENCES "users"("id");
    ALTER TABLE "day_log_team_mates" DROP CONSTRAINT IF EXISTS "day_log_team_mates_sorted_chk";
    DROP INDEX IF EXISTS "day_log_team_mates_pair_uq";
    DROP INDEX IF EXISTS "day_log_team_mates_high_idx";
    ALTER TABLE "day_log_team_mates" ALTER COLUMN "user_low_id" DROP NOT NULL;
    ALTER TABLE "day_log_team_mates" ALTER COLUMN "user_high_id" DROP NOT NULL;

    WITH dir AS (
      SELECT m.id,
        bool_or(starts_with(a.detail, 'Teams Config: ' || COALESCE(lo.full_name, lo.email) || ' and ')) AS low_first,
        bool_or(starts_with(a.detail, 'Teams Config: ' || COALESCE(hi.full_name, hi.email) || ' and ')) AS high_first
      FROM "day_log_team_mates" m
      JOIN public.users lo ON lo.id = m.user_low_id
      JOIN public.users hi ON hi.id = m.user_high_id
      LEFT JOIN public.activity_log a
        ON a.entity = 'Day Log Team Mate' AND a.action = 'CREATE' AND a.entity_id = m.id
      GROUP BY m.id)
    UPDATE "day_log_team_mates" m SET
      user_id = CASE WHEN d.low_first IS TRUE AND d.high_first IS NOT TRUE THEN m.user_low_id
                     WHEN d.high_first IS TRUE AND d.low_first IS NOT TRUE THEN m.user_high_id
                     ELSE m.user_low_id END,
      mate_id = CASE WHEN d.low_first IS TRUE AND d.high_first IS NOT TRUE THEN m.user_high_id
                     WHEN d.high_first IS TRUE AND d.low_first IS NOT TRUE THEN m.user_low_id
                     ELSE m.user_high_id END,
      deleted_at = CASE WHEN m.deleted_at IS NULL
                         AND (d.low_first IS TRUE) = (d.high_first IS TRUE) THEN now()
                        ELSE m.deleted_at END,
      deleted_by = CASE WHEN m.deleted_at IS NULL
                         AND (d.low_first IS TRUE) = (d.high_first IS TRUE) THEN m.created_by
                        ELSE m.deleted_by END
    FROM dir d
    WHERE d.id = m.id;

    ALTER TABLE "day_log_team_mates" ALTER COLUMN "user_id" SET NOT NULL;
    ALTER TABLE "day_log_team_mates" ALTER COLUMN "mate_id" SET NOT NULL;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "day_log_team_mates" ADD CONSTRAINT "day_log_team_mates_not_self_chk"
    CHECK ("user_id" <> "mate_id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "day_log_team_mates_user_mate_uq"
  ON "day_log_team_mates" ("company_id", "user_id", "mate_id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "day_log_team_mates_mate_idx"
  ON "day_log_team_mates" ("mate_id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
DROP POLICY IF EXISTS "day_log_team_mates_own_read" ON "day_log_team_mates";
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "day_log_team_mates_user_read" ON "day_log_team_mates"
    FOR SELECT TO authenticated
    USING (company_id = current_company_id() AND user_id = current_user_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- DOWN (not run): one-way rows cannot be folded back into sorted pairs
-- without losing a direction; restore from backup if ever needed.
