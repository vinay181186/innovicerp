-- ============================================================
-- 0198_invoice_cancel.sql  (ADR-202 Phase 3 — Invoice cancel)
--
-- An invoice is a statutory GST document, so a correction is NOT an edit: it is
-- a reason-logged CANCEL (cancel-and-reissue), mirroring the JW invoice
-- (ADR-194). This migration gives the invoice the SAME shape as jw_invoices:
--   1. 'cancelled' added to the invoice_status enum.
--   2. cancelled_at / cancelled_by / cancel_reason columns on invoices.
-- The INV-#### series is NEVER renumbered or deleted — a cancelled invoice row
-- is kept so the number series stays intact.
--
-- ALTER TYPE ... ADD VALUE must be its own auto-committed statement (it cannot
-- run inside the same transaction that then uses the new value); apply-sql runs
-- each statement separately. The ADD COLUMNs do not reference the new value, so
-- they are safe in this same file.
-- Idempotent (IF NOT EXISTS throughout). Apply to BOTH test and production.
-- Rollback: ALTER TABLE public.invoices
--             DROP COLUMN IF EXISTS cancel_reason,
--             DROP COLUMN IF EXISTS cancelled_by,
--             DROP COLUMN IF EXISTS cancelled_at;
--           (enum values cannot be removed in Postgres; 'cancelled' stays.)
-- ============================================================

ALTER TYPE invoice_status ADD VALUE IF NOT EXISTS 'cancelled';
--> statement-breakpoint

ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamptz;
--> statement-breakpoint

ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "cancelled_by" uuid REFERENCES users(id);
--> statement-breakpoint

ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "cancel_reason" text;
