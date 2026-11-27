-- 0268 — Day Log Personal Leave, part 2 (owner 2026-11-27): Full Day or Half
-- Day leave. A Half Day is one date with the person's own From–To leave time;
-- entries may be logged outside that time, never inside it. Stored on the day
-- header next to 0222's day_status 'leave' + leave_reason:
--   leave_kind  'full' | 'half'  (every existing row reads 'full' — the only
--               kind before this; it means nothing unless day_status = 'leave')
--   leave_from / leave_to  the Half Day's leave time; NULL for a Full Day.
-- Additive and idempotent: columns IF NOT EXISTS, constraints guarded.
-- Apply: DB_TARGET=TEST|PROD … tsx src/db/apply-sql.ts (PROD only via release script).

ALTER TABLE "daily_reports" ADD COLUMN IF NOT EXISTS "leave_kind" text NOT NULL DEFAULT 'full';
--> statement-breakpoint
ALTER TABLE "daily_reports" ADD COLUMN IF NOT EXISTS "leave_from" time;
--> statement-breakpoint
ALTER TABLE "daily_reports" ADD COLUMN IF NOT EXISTS "leave_to" time;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_leave_kind_chk"
    CHECK (leave_kind IN ('full', 'half'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
-- A Half Day carries both times, To after From; a Full Day carries none.
DO $$ BEGIN
  ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_leave_time_chk"
    CHECK (
      (leave_kind = 'full' AND leave_from IS NULL AND leave_to IS NULL)
      OR (leave_kind = 'half' AND leave_from IS NOT NULL AND leave_to IS NOT NULL
          AND leave_to > leave_from)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
