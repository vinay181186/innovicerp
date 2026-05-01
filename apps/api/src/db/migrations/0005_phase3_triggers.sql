-- ============================================================
-- 0005_phase3_triggers
-- BEFORE UPDATE triggers for the Phase 3 op-entry tables.
-- Tables that mutate after insert: route_cards, route_card_ops,
-- job_cards, jc_ops, running_ops.
-- Excluded (immutable / append-only): route_card_revisions, op_log.
-- Mirrors the pattern from 0003_phase2_triggers.sql.
-- ============================================================

CREATE OR REPLACE TRIGGER route_cards_set_updated_at
  BEFORE UPDATE ON public.route_cards
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint

CREATE OR REPLACE TRIGGER route_card_ops_set_updated_at
  BEFORE UPDATE ON public.route_card_ops
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint

CREATE OR REPLACE TRIGGER job_cards_set_updated_at
  BEFORE UPDATE ON public.job_cards
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint

CREATE OR REPLACE TRIGGER jc_ops_set_updated_at
  BEFORE UPDATE ON public.jc_ops
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint

CREATE OR REPLACE TRIGGER running_ops_set_updated_at
  BEFORE UPDATE ON public.running_ops
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
