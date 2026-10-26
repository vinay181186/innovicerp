-- ============================================================
-- 0221_cancel_requests_phase_c2
-- ADR-235 Phase C, part 2 — the standard Cancel for Job Card, Production
-- Order, DC Receipt (OSP) and JW DC Receipt (inward).
--   1. cancel_requests_doc_type_chk widened (packages/shared CANCEL_DOC_TYPES).
--   2. cancel_reason / cancelled_at / cancelled_by on job_cards,
--      production_orders, delivery_challan_receipts, jw_dc_inward. Each of these
--      is cancelled by stamping deleted_at too (header + its lines / ops, one
--      stamp), so every live reader — ~76 files read job_cards.deleted_at —
--      keeps skipping it unchanged; the list screens read cancelled_at to show
--      the Cancelled rows.
--   3. delivery_challan_receipts.goods_receipt_note_id — the auto-GRN a receipt
--      raised (jw_dc_inward already carries its own). Written by the receive
--      path from now on. Backfill only where it is certain:
--        a. the DC has exactly one live receipt and exactly one live GRN; or
--        b. the GRN's remarks are the receive path's default
--           "Auto GRN from OSP receipt <receipt code>".
--      Any other old receipt stays NULL, and its cancel is refused (it cannot
--      name the GRN it would have to cancel).
-- Additive and idempotent. The backfill only fills NULLs.
-- Apply: DB_TARGET=TEST|PROD … tsx src/db/apply-sql.ts (see apply-sql.ts header).
-- ============================================================

ALTER TABLE "cancel_requests" DROP CONSTRAINT IF EXISTS "cancel_requests_doc_type_chk";
--> statement-breakpoint
ALTER TABLE "cancel_requests" ADD CONSTRAINT "cancel_requests_doc_type_chk"
  CHECK ("doc_type" IN (
    'invoice', 'jw_invoice', 'customer_dispatch',
    'jw_return', 'customer_material_return', 'party_grn', 'party_material_issue',
    'delivery_challan', 'store_issue', 'stock_count', 'tool_issue',
    'purchase_request', 'purchase_order',
    'jw_dc_outward', 'plan', 'job_work_order', 'sales_order', 'grn',
    'job_card', 'production_order', 'dc_receipt', 'jw_dc_inward'
  ));
--> statement-breakpoint
ALTER TABLE "job_cards" ADD COLUMN IF NOT EXISTS "cancel_reason" text;
--> statement-breakpoint
ALTER TABLE "job_cards" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "job_cards" ADD COLUMN IF NOT EXISTS "cancelled_by" uuid REFERENCES "users"("id");
--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "cancel_reason" text;
--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "cancelled_by" uuid REFERENCES "users"("id");
--> statement-breakpoint
ALTER TABLE "delivery_challan_receipts" ADD COLUMN IF NOT EXISTS "cancel_reason" text;
--> statement-breakpoint
ALTER TABLE "delivery_challan_receipts" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "delivery_challan_receipts" ADD COLUMN IF NOT EXISTS "cancelled_by" uuid REFERENCES "users"("id");
--> statement-breakpoint
ALTER TABLE "delivery_challan_receipts" ADD COLUMN IF NOT EXISTS "goods_receipt_note_id" uuid REFERENCES "goods_receipt_notes"("id");
--> statement-breakpoint
ALTER TABLE "jw_dc_inward" ADD COLUMN IF NOT EXISTS "cancel_reason" text;
--> statement-breakpoint
ALTER TABLE "jw_dc_inward" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "jw_dc_inward" ADD COLUMN IF NOT EXISTS "cancelled_by" uuid REFERENCES "users"("id");
--> statement-breakpoint
-- Backfill a: one live receipt + one live GRN on the DC.
UPDATE "delivery_challan_receipts" r
   SET "goods_receipt_note_id" = g.id
  FROM "goods_receipt_notes" g
 WHERE r."goods_receipt_note_id" IS NULL
   AND r."deleted_at" IS NULL
   AND g."delivery_challan_id" = r."delivery_challan_id"
   AND g."deleted_at" IS NULL
   AND (SELECT count(*) FROM "delivery_challan_receipts" r2
         WHERE r2."delivery_challan_id" = r."delivery_challan_id" AND r2."deleted_at" IS NULL) = 1
   AND (SELECT count(*) FROM "goods_receipt_notes" g2
         WHERE g2."delivery_challan_id" = r."delivery_challan_id" AND g2."deleted_at" IS NULL) = 1;
--> statement-breakpoint
-- Backfill b: the receive path's default remarks name the receipt.
UPDATE "delivery_challan_receipts" r
   SET "goods_receipt_note_id" = g.id
  FROM "goods_receipt_notes" g
 WHERE r."goods_receipt_note_id" IS NULL
   AND r."deleted_at" IS NULL
   AND g."delivery_challan_id" = r."delivery_challan_id"
   AND g."deleted_at" IS NULL
   AND g."remarks" = 'Auto GRN from OSP receipt ' || r."receipt_code"
   AND NOT EXISTS (SELECT 1 FROM "delivery_challan_receipts" r3
                    WHERE r3."goods_receipt_note_id" = g.id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delivery_challan_receipts_grn_idx"
  ON "delivery_challan_receipts" ("goods_receipt_note_id") WHERE "goods_receipt_note_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_cards_company_cancelled_idx"
  ON "job_cards" ("company_id", "cancelled_at") WHERE "cancelled_at" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "production_orders_company_cancelled_idx"
  ON "production_orders" ("company_id", "cancelled_at") WHERE "cancelled_at" IS NOT NULL;

-- Rollback (manual):
-- DROP INDEX IF EXISTS "production_orders_company_cancelled_idx";
-- DROP INDEX IF EXISTS "job_cards_company_cancelled_idx";
-- DROP INDEX IF EXISTS "delivery_challan_receipts_grn_idx";
-- ALTER TABLE "delivery_challan_receipts" DROP COLUMN IF EXISTS "goods_receipt_note_id";
-- ALTER TABLE <job_cards / production_orders / delivery_challan_receipts / jw_dc_inward>
--   DROP COLUMN IF EXISTS "cancelled_by", DROP COLUMN IF EXISTS "cancelled_at", DROP COLUMN IF EXISTS "cancel_reason";
-- Re-add cancel_requests_doc_type_chk with the 0220 list.
