-- ADR-277 — a Route Card may be a Draft: saved by its creator, not sent for
-- approval. Save keeps it `draft`; Save & Submit (or Submit for Approval) moves
-- it to `pending`, and a pending card is locked until the approver decides.
--
-- Only the CHECK changes: `draft` becomes an allowed value. No row is changed.
-- The column DEFAULT stays 'approved' for the reason in 0219: the release
-- applies migrations BEFORE the new code is live, and the old code must keep
-- behaving as before in that window. Safe to re-run.
--
-- ROLLBACK (only once no live code writes `draft`; a Draft has to go somewhere
-- first, because the old CHECK refuses it):
--   UPDATE public.route_cards SET approval_status = 'pending' WHERE approval_status = 'draft';
--   ALTER TABLE public.route_cards DROP CONSTRAINT IF EXISTS route_cards_approval_status_check;
--   ALTER TABLE public.route_cards ADD CONSTRAINT route_cards_approval_status_check
--     CHECK (approval_status IN ('pending', 'approved', 'rejected'));

ALTER TABLE public.route_cards DROP CONSTRAINT IF EXISTS route_cards_approval_status_check;
--> statement-breakpoint
ALTER TABLE public.route_cards
  ADD CONSTRAINT route_cards_approval_status_check
  CHECK (approval_status IN ('draft', 'pending', 'approved', 'rejected'));
