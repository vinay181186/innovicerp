-- ============================================================
-- 0059_so_status_draft
-- Save-as-draft (#3/#4). Adds a `draft` value to the shared so_status enum so a
-- Sales Order can be saved as a draft and shown as such in the SO Master list.
-- The enum backs both sales_orders.status and job_work_orders.status.
--
-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction block and the
-- new value cannot be used in the same transaction. Run this statement on its
-- own (idempotent via IF NOT EXISTS). Positioned before 'open' for natural sort.
-- ============================================================

ALTER TYPE "so_status" ADD VALUE IF NOT EXISTS 'draft' BEFORE 'open';
