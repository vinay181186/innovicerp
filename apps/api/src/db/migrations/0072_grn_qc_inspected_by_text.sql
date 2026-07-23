-- 0072 — add a free-text QC inspector name to GRN lines.
--
-- The QC Call Register captures a mandatory typed "QC By" name for incoming QC
-- (may differ from the submitting account, goods_receipt_note_lines.qc_inspected_by
-- which stays as the user FK for audit). Store the typed name here.
-- Additive, nullable; idempotent.

ALTER TABLE public.goods_receipt_note_lines
  ADD COLUMN IF NOT EXISTS qc_inspected_by_text text;
