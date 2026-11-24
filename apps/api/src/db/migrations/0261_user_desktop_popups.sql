-- ============================================================
-- 0261 — ADR-314: per-person Desktop Pop-ups switch.
--   users.desktop_popups — 'allowed' (default) | 'disabled'. A disabled login
--   gets no Web Push pop-up on any laptop: GET /me/push answers enabled:false,
--   subscribe / test are refused, and the sender settles that person's pending
--   notices as 'off' without sending. Bell notes (task_notices) are unchanged.
-- Additive and idempotent — one NOT NULL column with a default (every existing
-- login becomes 'allowed'), plus a guarded CHECK. No other data change.
-- Apply: DB_TARGET=TEST|PROD … tsx src/db/apply-sql.ts (see apply-sql.ts header).
-- ============================================================

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "desktop_popups" text NOT NULL DEFAULT 'allowed';
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_desktop_popups_check' AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_desktop_popups_check"
      CHECK ("desktop_popups" IN ('allowed', 'disabled'));
  END IF;
END $$;
