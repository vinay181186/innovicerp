-- ADR-272 (owner 2026-11-05) — Day Log Pending Entries count from 28-10-2026, not
-- from the release date. Data only. Safe to re-run. New companies keep the column
-- default from 0240. A login created later still starts on its own creation date.

UPDATE "companies" SET "day_log_pending_from" = DATE '2026-10-28';
