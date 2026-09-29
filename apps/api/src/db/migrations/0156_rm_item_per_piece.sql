-- ============================================================
-- 0156_rm_item_per_piece.sql  (ADR-193 phase 3a)
--
-- A Job Card's raw material becomes a real Item Master item plus how much of
-- it one piece takes, so the store can see Required = qty per piece × JC qty
-- and issue against it. Source of truth: the Route Card; the Plan and the Job
-- Card keep a snapshot (same chain as raw-material grade / size, 0106/0108).
-- Both columns are optional: a JC without them is "not planned" and accepts
-- any issue without a cap (paper test P11).
-- Idempotent. Apply to BOTH the test and the production database.
-- Rollback: ALTER TABLE route_cards / plans / job_cards
--             DROP COLUMN raw_material_item_id, DROP COLUMN rm_qty_per_piece;
-- ============================================================

ALTER TABLE public.route_cards
  ADD COLUMN IF NOT EXISTS raw_material_item_id uuid REFERENCES public.items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rm_qty_per_piece numeric(14,4) CHECK (rm_qty_per_piece IS NULL OR rm_qty_per_piece > 0);
--> statement-breakpoint
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS raw_material_item_id uuid REFERENCES public.items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rm_qty_per_piece numeric(14,4) CHECK (rm_qty_per_piece IS NULL OR rm_qty_per_piece > 0);
--> statement-breakpoint
ALTER TABLE public.job_cards
  ADD COLUMN IF NOT EXISTS raw_material_item_id uuid REFERENCES public.items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rm_qty_per_piece numeric(14,4) CHECK (rm_qty_per_piece IS NULL OR rm_qty_per_piece > 0);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS job_cards_rm_item_idx ON public.job_cards (raw_material_item_id)
  WHERE deleted_at IS NULL AND raw_material_item_id IS NOT NULL;
