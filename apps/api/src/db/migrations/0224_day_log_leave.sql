-- ============================================================
-- 0224_day_log_leave
-- Day Log (owner 2026-10-26, option A): a third entry Type "Leave" — leaving
-- early / half day / permission. It starts where the last entry ended, always
-- ends at 06:00 PM, has no SO / JWSO, is never Open and is the day's last
-- entry (rules in apps/api/src/modules/day-logs/writes.ts).
--   1. 'leave' added to the day_log_entry_kind enum.
--
-- ALTER TYPE ... ADD VALUE must be its own auto-committed statement; apply-sql
-- runs an enum-adding file statement by statement. Nothing here uses the new
-- value. Idempotent. Apply to BOTH test and production (release script).
-- Rollback: none needed — enum values cannot be removed; 'leave' stays unused.
-- ============================================================

ALTER TYPE day_log_entry_kind ADD VALUE IF NOT EXISTS 'leave';
