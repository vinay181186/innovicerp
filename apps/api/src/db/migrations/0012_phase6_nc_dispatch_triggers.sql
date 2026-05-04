-- Phase 6 (T-039) — BEFORE UPDATE triggers for nc_register, delivery_challans,
-- delivery_challan_lines. Hand-written companion to 0011_phase6_nc_dispatch.sql
-- (drizzle-gen). Same pattern as Phase 2/3/4/5 master/transactional triggers.
-- Idempotent so re-runs via apply-sql.ts are safe.

DROP TRIGGER IF EXISTS nc_register_set_updated_at ON public.nc_register;
--> statement-breakpoint
CREATE TRIGGER nc_register_set_updated_at
  BEFORE UPDATE ON public.nc_register
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
DROP TRIGGER IF EXISTS delivery_challans_set_updated_at ON public.delivery_challans;
--> statement-breakpoint
CREATE TRIGGER delivery_challans_set_updated_at
  BEFORE UPDATE ON public.delivery_challans
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint
DROP TRIGGER IF EXISTS delivery_challan_lines_set_updated_at ON public.delivery_challan_lines;
--> statement-breakpoint
CREATE TRIGGER delivery_challan_lines_set_updated_at
  BEFORE UPDATE ON public.delivery_challan_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
