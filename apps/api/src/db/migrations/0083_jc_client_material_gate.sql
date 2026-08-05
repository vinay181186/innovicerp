-- 0083 — ADR-103: gate the first operation of a JWSO Job Card on material
-- ISSUED to it, not merely RECEIVED from the customer.
--
-- ADR-096/097 capped the first op at the Party-GRN received qty for the part.
-- That let work start on material the store had never handed out, so the Party
-- Material Issue document was optional in practice — the whole database held
-- exactly ONE. Party stock therefore never came down: PM-0001 read
-- "received 161 · issued 0 · on hand 161" while 50 finished pieces had already
-- gone back to the customer.
--
-- New rule (user's, 2026-08-05): an operator may only start/log up to what has
-- been ISSUED to that job card. Nothing issued = no start.
--
-- CUTOVER: existing Job Cards are deliberately left on the old behaviour.
-- Switching them would freeze five live jobs on day one — IN-JC-26-00005,
-- 00021, 00024, 00025 and 00028 all have zero issued — and IN-JC-26-00027 has
-- already machined 20 against 10 issued. The flag makes the boundary visible in
-- the data instead of hiding a cutover date inside the code.
--
--   client_material_gate = TRUE  → issued-based (ADR-103), all NEW job cards
--   client_material_gate = FALSE → received-based (ADR-096/097), pre-cutover
--
-- The flag is read only for JWSO-sourced job cards; SO-sourced ones were never
-- capped and still aren't.

ALTER TABLE public.job_cards
  ADD COLUMN IF NOT EXISTS client_material_gate boolean NOT NULL DEFAULT true;
--> statement-breakpoint

-- Every job card that exists right now keeps the old behaviour.
UPDATE public.job_cards
SET client_material_gate = false
WHERE client_material_gate IS DISTINCT FROM false;
--> statement-breakpoint

COMMENT ON COLUMN public.job_cards.client_material_gate IS
  'ADR-103: when true, the first op is capped at party material ISSUED to this JC; when false, the legacy ADR-096/097 cap on party material RECEIVED for the part. Pre-cutover job cards are false.';
