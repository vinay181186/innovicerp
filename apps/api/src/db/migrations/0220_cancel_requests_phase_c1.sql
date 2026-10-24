-- ============================================================
-- 0220_cancel_requests_phase_c1
-- ADR-235 Phase C, part 1 — the standard Cancel for five documents that had no
-- real cancel: JW DC (outward), Plan, JWSO, Sales Order, GRN.
--   1. cancel_requests_doc_type_chk widened (packages/shared CANCEL_DOC_TYPES).
--   2. cancel_reason / cancelled_at / cancelled_by on sales_orders,
--      job_work_orders, plans, goods_receipt_notes, jw_dc_outward — the reason
--      on the cancelled row, as every other cancellable document carries.
--      SO / JWSO / Plan already have a 'cancelled' status value (so_status,
--      plan_status); GRN and JW DC are cancelled by stamping deleted_at too
--      (every live reader keeps skipping them unchanged) plus these columns,
--      and their list screens read them to show the Cancelled rows.
-- Additive and idempotent — new nullable columns, no data change. Existing
-- cancelled SOs keep NULL (their reason is in the activity log).
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
    'jw_dc_outward', 'plan', 'job_work_order', 'sales_order', 'grn'
  ));
--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN IF NOT EXISTS "cancel_reason" text;
--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN IF NOT EXISTS "cancelled_by" uuid REFERENCES "users"("id");
--> statement-breakpoint
ALTER TABLE "job_work_orders" ADD COLUMN IF NOT EXISTS "cancel_reason" text;
--> statement-breakpoint
ALTER TABLE "job_work_orders" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "job_work_orders" ADD COLUMN IF NOT EXISTS "cancelled_by" uuid REFERENCES "users"("id");
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "cancel_reason" text;
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "cancelled_by" uuid REFERENCES "users"("id");
--> statement-breakpoint
ALTER TABLE "goods_receipt_notes" ADD COLUMN IF NOT EXISTS "cancel_reason" text;
--> statement-breakpoint
ALTER TABLE "goods_receipt_notes" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "goods_receipt_notes" ADD COLUMN IF NOT EXISTS "cancelled_by" uuid REFERENCES "users"("id");
--> statement-breakpoint
ALTER TABLE "jw_dc_outward" ADD COLUMN IF NOT EXISTS "cancel_reason" text;
--> statement-breakpoint
ALTER TABLE "jw_dc_outward" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "jw_dc_outward" ADD COLUMN IF NOT EXISTS "cancelled_by" uuid REFERENCES "users"("id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "goods_receipt_notes_company_cancelled_idx"
  ON "goods_receipt_notes" ("company_id", "cancelled_at") WHERE "cancelled_at" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jw_dc_outward_company_cancelled_idx"
  ON "jw_dc_outward" ("company_id", "cancelled_at") WHERE "cancelled_at" IS NOT NULL;

-- Rollback (manual):
-- DROP INDEX IF EXISTS "jw_dc_outward_company_cancelled_idx";
-- DROP INDEX IF EXISTS "goods_receipt_notes_company_cancelled_idx";
-- ALTER TABLE <each of the five tables> DROP COLUMN IF EXISTS "cancelled_by", DROP COLUMN IF EXISTS "cancelled_at", DROP COLUMN IF EXISTS "cancel_reason";
-- Re-add cancel_requests_doc_type_chk with the 0218 list.
