-- ============================================================
-- 0199_store_issue_issued_to_user.sql
-- "Issued To" on Item Issue (store_issues) now points at an app LOGIN who holds
-- a granted Production working right, not the Operator master.
--   - store_issues.issued_to_user_id uuid NULL → users(id) ON DELETE SET NULL.
--     Additive; the existing issued_to text snapshot and issued_to_operator_id
--     stay as historical data (no backfill).
-- Idempotent. Apply to BOTH databases (PROD + TEST).
-- Rollback: DROP INDEX IF EXISTS public.store_issues_issued_to_user_idx;
--           ALTER TABLE public.store_issues DROP COLUMN IF EXISTS issued_to_user_id;
-- ============================================================

ALTER TABLE public.store_issues
  ADD COLUMN IF NOT EXISTS issued_to_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS store_issues_issued_to_user_idx
  ON public.store_issues (issued_to_user_id)
  WHERE issued_to_user_id IS NOT NULL;
