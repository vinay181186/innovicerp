-- ============================================================
-- 0108_route_card_raw_material
--
-- The Route Card is the one-per-item process sheet: it says HOW the part is
-- made. Grade and size say WHAT it is made from, so they belong on the same
-- sheet — the shop floor reads one document, not two.
--
-- Same shape as 0106 / 0107: an FK to the master plus a text snapshot, all
-- nullable. The snapshot is what the detail page and the printed route card
-- show, so renaming or removing a grade never rewrites an old route card.
--
-- Idempotent — the single step is guarded, so a re-run is a no-op.
-- ============================================================

ALTER TABLE public.route_cards
  ADD COLUMN IF NOT EXISTS raw_material_grade_id uuid
    REFERENCES public.material_grades(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS raw_material_grade_text text,
  ADD COLUMN IF NOT EXISTS raw_material_size_id uuid
    REFERENCES public.material_sizes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS raw_material_size_text text;
