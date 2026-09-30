-- ============================================================
-- 0180_schema_migrations.sql  (finding S7 — "no record of database changes")
--
-- The migration record, like ERPNext's Patch Log: one row per migration file
-- that apps/api/src/db/apply-sql.ts has applied to THIS database.
--
--   filename    the file's base name, e.g. '0180_schema_migrations.sql' (PK)
--   checksum    sha256 of the file text (CRLF normalised to LF) at apply time;
--               a later re-apply with a different checksum = the file was edited
--   applied_at  when it was last applied
--   applied_by  OS user @ host that ran apply-sql
--   target      'TEST' | 'PROD' | 'LOCAL' — the DB_TARGET the runner was given
--
-- apply-sql writes the row inside the same transaction as the migration, so a
-- failed file leaves no row. apply-sql skips the write while this table does not
-- exist yet, so this file itself can be applied by the new runner (and it then
-- records itself). Files applied before 0180 are NOT back-filled — the record
-- starts here.
--
-- Security: RLS on with no policies = anon / authenticated (PostgREST) cannot
-- read or write it; the API and apply-sql connect as postgres (BYPASSRLS).
-- Additive + idempotent. Apply to BOTH the test and the production database.
-- ROLLBACK: DROP TABLE public.schema_migrations;
-- ============================================================

CREATE TABLE IF NOT EXISTS public.schema_migrations (
  filename text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  applied_by text,
  target text
);
--> statement-breakpoint
ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
COMMENT ON TABLE public.schema_migrations IS
  'Migration record (like ERPNext Patch Log): one row per SQL file applied by apps/api/src/db/apply-sql.ts. Migration 0180.';
