-- ============================================================
-- 0009_phase4_triggers
-- BEFORE UPDATE triggers for the Phase 4 sales-chain tables.
-- Mirrors the pattern from 0005_phase3_triggers.sql.
-- ============================================================

CREATE OR REPLACE TRIGGER sales_orders_set_updated_at
  BEFORE UPDATE ON public.sales_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint

CREATE OR REPLACE TRIGGER sales_order_lines_set_updated_at
  BEFORE UPDATE ON public.sales_order_lines
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint

CREATE OR REPLACE TRIGGER job_work_orders_set_updated_at
  BEFORE UPDATE ON public.job_work_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint

CREATE OR REPLACE TRIGGER job_work_order_lines_set_updated_at
  BEFORE UPDATE ON public.job_work_order_lines
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
