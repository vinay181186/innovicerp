-- ADR-282 — a Job Card stores the Route Card and Rev it is built on, and whether a
-- routing change of its own could not be sent to that card.
--
--   route_card_id        the card it is built on; NULL = never recorded, never guessed
--   route_card_revision  that card's Rev when it was built, or when a change last reached it
--   route_card_not_sent  a routing change is held back (card Draft / Pending / Returned,
--                        or a change already waiting)
--
-- Backfill: a Job Card built by a live Production Order takes that order's card and
-- Rev snapshot. Every other Job Card stays NULL. Nothing is inferred from the item.
--
-- The updated_at trigger is off for the backfill only: this is not an edit, and a
-- moved updated_at would refuse (409) the save of any Job Card form open during the
-- release. One transaction (apply-sql), so the trigger cannot be left off.
-- No RLS or ledger guard on job_cards affects this; the runner bypasses RLS.
-- Safe to re-run: only rows with no card yet are filled.
--
-- ROLLBACK (only after the code reading them is gone):
--   ALTER TABLE public.job_cards
--     DROP COLUMN route_card_id, DROP COLUMN route_card_revision, DROP COLUMN route_card_not_sent;

ALTER TABLE public.job_cards
  ADD COLUMN IF NOT EXISTS route_card_id uuid REFERENCES public.route_cards(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS route_card_revision integer,
  ADD COLUMN IF NOT EXISTS route_card_not_sent boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS job_cards_route_card_idx
  ON public.job_cards (route_card_id)
  WHERE route_card_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE public.job_cards DISABLE TRIGGER job_cards_set_updated_at;
--> statement-breakpoint
UPDATE public.job_cards jc
   SET route_card_id = po.route_card_id,
       route_card_revision = po.route_card_revision
  FROM public.production_orders po
 WHERE po.job_card_id = jc.id
   AND po.company_id = jc.company_id
   AND po.deleted_at IS NULL
   AND jc.route_card_id IS NULL;
--> statement-breakpoint
ALTER TABLE public.job_cards ENABLE TRIGGER job_cards_set_updated_at;
