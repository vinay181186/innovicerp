-- ADR-253 — a NEW Route Card must be approved before it can be used.
--
-- route_cards gains its approval state:
--   approval_status  pending | approved | rejected  (CHECK)
--   approved_by/at, rejected_by/at, rejection_reason
-- Only an APPROVED card may raise a Production Order / ML-plan order; a plan
-- whose item card is not approved shows "Route card awaiting approval".
--
-- Existing cards (43 on PROD, 2026-10-24) are set 'approved' — they were in
-- use before this rule (owner: yes). The column is added with DEFAULT
-- 'approved' (fills existing rows in one step), then the default becomes
-- 'pending' so any future insert that forgets to set it is held, never
-- silently usable. approved_at/by stay NULL on those legacy rows (unknown).
--
-- Additive; no data is changed except the new column's value.
-- ROLLBACK:
--   ALTER TABLE public.route_cards DROP CONSTRAINT IF EXISTS route_cards_approval_status_check;
--   ALTER TABLE public.route_cards DROP COLUMN approval_status, DROP COLUMN approved_by,
--     DROP COLUMN approved_at, DROP COLUMN rejected_by, DROP COLUMN rejected_at,
--     DROP COLUMN rejection_reason;

ALTER TABLE public.route_cards
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text;
--> statement-breakpoint
ALTER TABLE public.route_cards ALTER COLUMN approval_status SET DEFAULT 'pending';
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'route_cards_approval_status_check') THEN
    ALTER TABLE public.route_cards
      ADD CONSTRAINT route_cards_approval_status_check
      CHECK (approval_status IN ('pending', 'approved', 'rejected'));
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS route_cards_pending_idx
  ON public.route_cards (company_id)
  WHERE deleted_at IS NULL AND approval_status = 'pending';
