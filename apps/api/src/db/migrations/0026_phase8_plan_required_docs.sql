-- ============================================================
-- 0026_phase8_plan_required_docs
-- PL-4b parity port — adds the Required QC Documents section
-- to plans (legacy editPlan modal, HTML L9654-9662).
--
-- Per plan: zero-or-more documents the QC operator must upload
-- during inspection. Mandatory docs block QC completion later.
-- Shape: jsonb array of { name: string, mandatory: boolean }.
-- Default '[]' keeps existing rows valid.
--
-- Idempotent — safe to re-run via _apply_0026.
-- ============================================================

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS required_docs jsonb NOT NULL DEFAULT '[]'::jsonb;
