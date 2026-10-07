-- ============================================================
-- 0201_assembly_assembled_by_user.sql
-- "Assembled By" on the Assembly Tracker (assembly_units) now points at an app
-- LOGIN who holds a granted Planning working right, not whatever was typed.
--   - assembly_units.assembled_by_user_id uuid NULL → users(id) ON DELETE SET NULL.
--     Additive; the existing assembled_by TEXT snapshot stays and is still
--     written on every path (it is what every read, print and activity-log line
--     shows, and it must survive the login being deactivated or renamed — no
--     backfill, old rows keep text only).
-- Mirrors 0199_store_issue_issued_to_user.sql, which did the same for "Issued
-- To" on Item Issue.
-- Idempotent. Apply to BOTH databases (PROD + TEST).
-- Rollback: DROP INDEX IF EXISTS public.assembly_units_assembled_by_user_idx;
--           ALTER TABLE public.assembly_units DROP COLUMN IF EXISTS assembled_by_user_id;
-- ============================================================

ALTER TABLE public.assembly_units
  ADD COLUMN IF NOT EXISTS assembled_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS assembly_units_assembled_by_user_idx
  ON public.assembly_units (assembled_by_user_id)
  WHERE assembled_by_user_id IS NOT NULL;
