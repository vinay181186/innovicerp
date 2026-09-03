-- ============================================================
-- 0107_bom_line_raw_material
--
-- Completes the raw-material chain started in 0105 / 0106.
--
-- A Job Card can be born in four places. Two of them (plan → Manufacture,
-- plan → Full Outsource) now copy the grade and size down from the plan. The
-- other two were still leaving it blank:
--
--   1. The BOM cascade — raises a child Job Card per BOM line.
--   2. The NC "make fresh" rework — raises a replacement Job Card.
--
-- (2) needs no schema: the replacement is the SAME part as the Job Card it
-- replaces, so it simply inherits that Job Card's grade and size.
--
-- (1) has nothing to inherit. A BOM child is a DIFFERENT part from its parent
-- and is generally cut from different stock, so copying the parent's grade
-- onto it would invent data. The BOM line itself is the only place that knows
-- what the child part is made from — so it gets its own grade and size, set
-- once on the BOM Master and copied onto every child Job Card the cascade
-- raises from it.
--
-- Same shape as 0106: FK + text snapshot, all nullable (a purchase or
-- outsource BOM line buys the part instead of cutting it).
--
-- Idempotent — every step is guarded, so a re-run is a no-op.
-- ============================================================

ALTER TABLE public.bom_master_lines
  ADD COLUMN IF NOT EXISTS raw_material_grade_id uuid
    REFERENCES public.material_grades(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS raw_material_grade_text text,
  ADD COLUMN IF NOT EXISTS raw_material_size_id uuid
    REFERENCES public.material_sizes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS raw_material_size_text text;
