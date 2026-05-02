-- ============================================================
-- 0010_phase5_triggers
-- BEFORE UPDATE triggers for the Phase 5 procurement tables.
-- Mirrors the pattern from 0009_phase4_triggers.sql.
-- store_transactions has no updated_at column (append-only per
-- ADR-011 #4) so it gets no trigger.
-- ============================================================

CREATE OR REPLACE TRIGGER purchase_requests_set_updated_at
  BEFORE UPDATE ON public.purchase_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint

CREATE OR REPLACE TRIGGER purchase_orders_set_updated_at
  BEFORE UPDATE ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint

CREATE OR REPLACE TRIGGER purchase_order_lines_set_updated_at
  BEFORE UPDATE ON public.purchase_order_lines
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint

CREATE OR REPLACE TRIGGER goods_receipt_notes_set_updated_at
  BEFORE UPDATE ON public.goods_receipt_notes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
--> statement-breakpoint

CREATE OR REPLACE TRIGGER goods_receipt_note_lines_set_updated_at
  BEFORE UPDATE ON public.goods_receipt_note_lines
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
