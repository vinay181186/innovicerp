-- ============================================================
-- 0106_plan_jc_raw_material
--
-- Carries the raw material (grade + size, from the 0105 masters) down the
-- stream: it is chosen on the PLAN, and copied onto the JOB CARD the plan
-- creates, so the JC header and the printed JC show what the part is cut from
-- without anyone re-typing it.
--
-- Each side stores an FK **and** a text snapshot. The snapshot is what gets
-- displayed and printed, so an old plan/JC still shows the grade and size it
-- was raised with after the master row is renamed, deactivated or removed
-- (the FK is ON DELETE SET NULL — the reference drops, the record does not
-- silently change).
--
-- Every column is nullable and optional: a Direct Purchase plan buys a
-- finished item and has no raw material at all.
--
-- Idempotent — every step is guarded, so a re-run is a no-op.
-- ============================================================

ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS raw_material_grade_id uuid
    REFERENCES public.material_grades(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS raw_material_grade_text text,
  ADD COLUMN IF NOT EXISTS raw_material_size_id uuid
    REFERENCES public.material_sizes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS raw_material_size_text text;
--> statement-breakpoint

ALTER TABLE public.job_cards
  ADD COLUMN IF NOT EXISTS raw_material_grade_id uuid
    REFERENCES public.material_grades(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS raw_material_grade_text text,
  ADD COLUMN IF NOT EXISTS raw_material_size_id uuid
    REFERENCES public.material_sizes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS raw_material_size_text text;
