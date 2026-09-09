-- 0117 — a Purchase Request can be SHORT-CLOSED: "we ordered 10 of 100 and the
-- rest is not coming".
--
-- Phase 2 of the PR→PO balance work (ADR-152). Phase 1 made the balance a
-- derived number — qty minus what is on live purchase order lines — which
-- already lets one PR carry several POs. This migration adds the other half:
-- a way to STOP.
--
-- Without it a partly-ordered PR is immortal. Order 10 of 100, then the customer
-- cuts their order, and the remaining 90 sits in the "still to buy" list forever:
-- the PR cannot be edited (quantity is already committed to a vendor) and cannot
-- be rejected (both guards refuse once any PO exists). Six months later somebody
-- buys the 90.
--
-- Short-closing is deliberately NOT the same as editing the qty down. The PR
-- still says 100 was asked for, because that is what happened; it records
-- separately that 90 was abandoned and why. Rewriting the original request to
-- match what was bought would destroy the audit trail the PR exists to keep —
-- the same reasoning that stops the PO conversion rewriting the PR's vendor.
--
-- All three columns nullable: the overwhelming majority of PRs are never
-- short-closed, and every existing row predates the idea.
--
-- ADDITIVE ONLY. Nothing is dropped, no existing row is touched, and no screen
-- changes behaviour until the Phase 2 code ships.
--
-- Idempotent — every step is guarded, so a re-run is a no-op.

ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS balance_closed_at     timestamptz,
  ADD COLUMN IF NOT EXISTS balance_closed_by     uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS balance_closed_reason text;
--> statement-breakpoint

-- A reason is not optional when the balance is closed. Enforced here rather than
-- only in Zod so a direct SQL fix cannot leave an unexplained abandonment: in six
-- months "why did we not buy the other 90?" is the only question anyone asks.
ALTER TABLE public.purchase_requests
  DROP CONSTRAINT IF EXISTS purchase_requests_balance_close_complete;
--> statement-breakpoint

ALTER TABLE public.purchase_requests
  ADD CONSTRAINT purchase_requests_balance_close_complete
  CHECK (
    balance_closed_at IS NULL
    OR (balance_closed_by IS NOT NULL AND length(btrim(coalesce(balance_closed_reason, ''))) > 0)
  );
--> statement-breakpoint

-- Drives the "still to order" list: a short-closed PR must drop out of the PO
-- form's picker even though its arithmetic balance is still positive.
CREATE INDEX IF NOT EXISTS purchase_requests_balance_open_idx
  ON public.purchase_requests (company_id)
  WHERE deleted_at IS NULL AND balance_closed_at IS NULL;
