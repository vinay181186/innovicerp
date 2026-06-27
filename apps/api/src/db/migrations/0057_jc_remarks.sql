-- ============================================================
-- 0057_jc_remarks
-- Add a free-text Remarks field to Job Cards (job_cards.remarks).
-- Nullable / optional — captured on the JC create/edit form, shown on the
-- JC list + detail. No data migration needed (existing rows stay NULL).
-- ============================================================

ALTER TABLE "job_cards" ADD COLUMN IF NOT EXISTS "remarks" text;
