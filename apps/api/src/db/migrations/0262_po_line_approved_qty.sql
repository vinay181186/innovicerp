-- ============================================================
-- 0262 — ADR-320: purchase_order_lines.approved_qty — the qty last APPROVED.
--   SO Status counts a PO line only once it is approved (owner 2026-11-24).
--   Editing an approved PO sends it back to draft and overwrites qty; this
--   column keeps the last approved figure so SO Status still shows it while the
--   edit waits for re-approval. Written ONLY by stampPoApprovedQty
--   (purchase-orders) whenever a PO is, or stays, approved. Null = never approved.
-- Backfill: every line of a PO that is approved today (open / partial /
--   qc_pending / closed) takes its current qty. Draft and cancelled lines stay null.
-- Additive and idempotent. No other data change.
-- Apply: DB_TARGET=TEST|PROD … tsx src/db/apply-sql.ts (see apply-sql.ts header).
-- ============================================================

ALTER TABLE "purchase_order_lines" ADD COLUMN IF NOT EXISTS "approved_qty" numeric(14, 3);
--> statement-breakpoint
UPDATE "purchase_order_lines" pol
SET "approved_qty" = pol."qty"
FROM "purchase_orders" po
WHERE po."id" = pol."purchase_order_id"
  AND po."status" IN ('open', 'partial', 'qc_pending', 'closed')
  AND pol."approved_qty" IS NULL;
