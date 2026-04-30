-- ============================================================
-- 0003_phase2_triggers
-- BEFORE UPDATE triggers for the Phase 2 master tables
-- (clients, vendors, machines, operators).
-- Mirrors the pattern from 0001_post_init.sql for the Phase 1 tables.
-- ============================================================

CREATE OR REPLACE TRIGGER clients_set_updated_at
  BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint

CREATE OR REPLACE TRIGGER vendors_set_updated_at
  BEFORE UPDATE ON public.vendors
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint

CREATE OR REPLACE TRIGGER machines_set_updated_at
  BEFORE UPDATE ON public.machines
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint

CREATE OR REPLACE TRIGGER operators_set_updated_at
  BEFORE UPDATE ON public.operators
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
