-- ============================================================
-- 0175_item_type_party_supplied.sql  (ADR-195)
--
-- Adds the sixth Item Type — 'party_supplied_material' — to the item_type PG
-- enum: raw material the CLIENT supplies for a job-work (JWSO) order. It is job
-- material, but the customer's property (never purchased, never company-valued
-- stock — its stock/value live in the zero-value party store, ADR-194). Its item
-- code carries an `-rm` suffix.
--
-- ALTER TYPE ... ADD VALUE must be its own auto-committed statement (it cannot run
-- inside an explicit transaction block), so this migration contains ONLY it.
-- Idempotent via IF NOT EXISTS. Apply to BOTH the test and the production database.
-- ============================================================

ALTER TYPE public.item_type ADD VALUE IF NOT EXISTS 'party_supplied_material';
