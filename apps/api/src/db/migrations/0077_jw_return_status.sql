-- ============================================================
-- 0077_jw_return_status
-- Adds a lifecycle status to JW Return Challans so an erroneous return can be
-- cancelled/reversed (see jw-returns service.cancelJwReturnChallan). Values:
-- 'issued' | 'cancelled'. Additive, idempotent — existing rows default to
-- 'issued'. Plain text (not an enum) to keep it simple. A partial index on
-- (company_id, status) backs status-filtered list queries.
-- ============================================================

ALTER TABLE public.jw_return_challans
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'issued';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS jw_return_challans_company_status_idx
  ON public.jw_return_challans (company_id, status)
  WHERE deleted_at IS NULL;
