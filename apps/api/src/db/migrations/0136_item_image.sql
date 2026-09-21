-- 0136 — Item Master product image (user decision 2026-09-21).
--
-- Every item may carry ONE picture (a 3D render, JPG/PNG/WebP, resized in the
-- browser to ≤800 px) shown as a fixed-size thumbnail next to code · name on
-- every screen. It is a product picture, not a controlled drawing: drawings
-- now live on the SO / JWSO line only (ADR-158/159/160), and the item-level
-- `drawing_file_path` (ADR-032) is left in place, read-only, for old items.
--
-- ADDITIVE: one nullable column, no data touched. Idempotent.

ALTER TABLE items ADD COLUMN IF NOT EXISTS image_path text;
