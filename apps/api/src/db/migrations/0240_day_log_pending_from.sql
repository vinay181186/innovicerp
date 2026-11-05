-- ADR-272 (owner 2026-11-05) — Day Log Pending Entries: the first date that can
-- be pending, per company. The default is the IST date this runs on, so each
-- database gets its own release date with no hand-set value. Re-running keeps
-- the value already there. Additive only.

ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "day_log_pending_from" date NOT NULL
  DEFAULT ((now() AT TIME ZONE 'Asia/Kolkata')::date);
