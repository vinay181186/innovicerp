-- ============================================================
-- 0218_cancel_requests_phase_b
-- ADR-235 Phase B — enrol ten more documents in the standard Cancel and make
-- a cancelled Party GRN / Party Material Issue visible as Cancelled.
--   1. cancel_requests_doc_type_chk widened to the Phase B types
--      (packages/shared CANCEL_DOC_TYPES is the list).
--   2. party_grn / party_material_issues .cancel_reason / cancelled_at /
--      cancelled_by — the reason on the cancelled row, as the other cancellable
--      documents carry. The cancel still stamps deleted_at too, so every live
--      reader (balances, pickers, QC call register, challan uniqueness) keeps
--      skipping a cancelled one unchanged; only the list screens read these
--      columns to show the Cancelled rows.
--   3. Backfill: a Party GRN / Party Material Issue header is soft-deleted ONLY
--      by its cancel (neither has a delete path or a Trash entry), so every
--      deleted header is a cancelled one. cancelled_at / _by come from the
--      deleted stamp; the reason from the "[Cancelled] <reason>" line the old
--      cancel appended to remarks (else a fixed sentence).
-- Additive and idempotent. The backfill touches only rows where
-- deleted_at IS NOT NULL AND cancelled_at IS NULL.
-- Apply: DB_TARGET=TEST|PROD … tsx src/db/apply-sql.ts (see apply-sql.ts header).
-- ============================================================

ALTER TABLE "cancel_requests" DROP CONSTRAINT IF EXISTS "cancel_requests_doc_type_chk";
--> statement-breakpoint
ALTER TABLE "cancel_requests" ADD CONSTRAINT "cancel_requests_doc_type_chk"
  CHECK ("doc_type" IN (
    'invoice', 'jw_invoice', 'customer_dispatch',
    'jw_return', 'customer_material_return', 'party_grn', 'party_material_issue',
    'delivery_challan', 'store_issue', 'stock_count', 'tool_issue',
    'purchase_request', 'purchase_order'
  ));
--> statement-breakpoint
ALTER TABLE "party_grn" ADD COLUMN IF NOT EXISTS "cancel_reason" text;
--> statement-breakpoint
ALTER TABLE "party_grn" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "party_grn" ADD COLUMN IF NOT EXISTS "cancelled_by" uuid REFERENCES "users"("id");
--> statement-breakpoint
ALTER TABLE "party_material_issues" ADD COLUMN IF NOT EXISTS "cancel_reason" text;
--> statement-breakpoint
ALTER TABLE "party_material_issues" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "party_material_issues" ADD COLUMN IF NOT EXISTS "cancelled_by" uuid REFERENCES "users"("id");
--> statement-breakpoint
UPDATE "party_grn"
   SET "cancelled_at" = "deleted_at",
       "cancelled_by" = "deleted_by",
       "cancel_reason" = COALESCE(
         NULLIF(btrim(substring("remarks" FROM '\[Cancelled\] ([^\n]*)$')), ''),
         'Cancelled before the reason was stored on the GRN (see History)')
 WHERE "deleted_at" IS NOT NULL AND "cancelled_at" IS NULL;
--> statement-breakpoint
UPDATE "party_material_issues"
   SET "cancelled_at" = "deleted_at",
       "cancelled_by" = "deleted_by",
       "cancel_reason" = COALESCE(
         NULLIF(btrim(substring("remarks" FROM '\[Cancelled\] ([^\n]*)$')), ''),
         'Cancelled before the reason was stored on the issue (see History)')
 WHERE "deleted_at" IS NOT NULL AND "cancelled_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "party_grn_company_cancelled_idx"
  ON "party_grn" ("company_id", "cancelled_at") WHERE "cancelled_at" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "party_material_issues_company_cancelled_idx"
  ON "party_material_issues" ("company_id", "cancelled_at") WHERE "cancelled_at" IS NOT NULL;

-- Rollback (manual):
-- DROP INDEX IF EXISTS "party_material_issues_company_cancelled_idx";
-- DROP INDEX IF EXISTS "party_grn_company_cancelled_idx";
-- ALTER TABLE "party_material_issues" DROP COLUMN IF EXISTS "cancelled_by", DROP COLUMN IF EXISTS "cancelled_at", DROP COLUMN IF EXISTS "cancel_reason";
-- ALTER TABLE "party_grn" DROP COLUMN IF EXISTS "cancelled_by", DROP COLUMN IF EXISTS "cancelled_at", DROP COLUMN IF EXISTS "cancel_reason";
-- ALTER TABLE "cancel_requests" DROP CONSTRAINT "cancel_requests_doc_type_chk";
-- ALTER TABLE "cancel_requests" ADD CONSTRAINT "cancel_requests_doc_type_chk" CHECK ("doc_type" IN ('invoice','jw_invoice','customer_dispatch'));
