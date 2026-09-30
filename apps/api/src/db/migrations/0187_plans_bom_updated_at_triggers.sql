-- ============================================================
-- 0187_plans_bom_updated_at_triggers.sql  (fix wave 3, area R — R5 edit conflict)
--
-- R5 refuses an edit when the row's updated_at moved after the form loaded it
-- (apps/api/src/lib/edit-conflict.ts). That only works if EVERY update of the
-- row bumps updated_at. Every checked table has the BEFORE UPDATE trigger
-- public.set_updated_at() (0001) except these two (TEST 2026-09-30, pg_trigger):
--   plans, bom_masters
-- Their edit services now also set updated_at themselves, so the check works
-- before this file runs; the trigger makes the other writers (status moves,
-- close, re-plan) bump it too.
--
-- Additive and idempotent (CREATE OR REPLACE TRIGGER, PG 14+). No data change.
-- ============================================================

CREATE OR REPLACE TRIGGER plans_set_updated_at
  BEFORE UPDATE ON public.plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint

CREATE OR REPLACE TRIGGER bom_masters_set_updated_at
  BEFORE UPDATE ON public.bom_masters
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
