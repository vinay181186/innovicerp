# Stock Valuation
**Module key:** `stock-valuation` · **Domain:** Procurement & Store

## Purpose
Values current on-hand item stock in rupees. Read-only report: for each item, value = on-hand qty × rate, where the rate is sourced by a fallback chain — the PO rate behind the item's **latest GRN**, else the item's **latest PO line rate**, else none (unvalued). Rows are grouped/summarised by item type (component / assembly). Mirror of legacy `renderStockValuation`.

## Pages / Screens
- `apps/web/src/modules/stock-valuation/routes/page.tsx` — valuation table with per-category subtotals and grand total

## Database Tables
No owned tables. Reads:
- `items` (master, `item_type`, `min_stock_qty`)
- `item_stock_balances` — on-hand qty
- `goods_receipt_note_lines` + `goods_receipt_notes` + `purchase_order_lines` — latest-GRN PO rate (rate>0)
- `purchase_order_lines` + `purchase_orders` — latest-PO-line rate fallback (rate>0)

## API Endpoints
routes.ts (authenticated):
- `GET /stock-valuation` — full valuation (no params; company-scoped)

## Services / Key Functions
service.ts:
- `getStockValuation(user)` → `{rows, categories, grandTotal, grandItems, grandStockItems}` — single query with two `DISTINCT ON` CTEs:
  - `last_grn_rate` — most recent GRN per item, taking the PO line rate behind it (grn_date DESC, created_at DESC).
  - `last_po_rate` — most recent PO line rate per item (po_date DESC).
  - Final select: on-hand from `item_stock_balances`, rate = COALESCE(grn rate, po rate, 0), `has_rate` flag, value = qty × rate, `low_stock` flag.
  - Aggregates per `item_type` category (count, in-stock count, value) plus grand totals.
- Read-only; runs in `withUserContext`. Note: uses `sql.raw` with the company id interpolated.

## Entry Points
- `stockValuationRoutes` (Fastify). Pure reporting read over items + stock cache + PO/GRN rates.

## Business Logic
- **Valuation method:** latest-cost proxy — not moving-average, not FIFO. Rate = last-GRN's PO rate → last PO-line rate → 0.
- **Rate provenance:** GRN-backed rate preferred (reflects actually-received cost); falls back to the most recent PO commitment; `has_rate=false` items (never on a rated PO/GRN) value at 0 and are flagged.
- **On-hand** taken from the ledger-derived `item_stock_balances` cache (same source as store-inventory).
- **Grouping:** subtotalled by item type (component/assembly); grand total + item counts + in-stock item count returned for the summary header.
- **Low-stock** flagged the same way as store-inventory (min>0 and on-hand ≤ min).

## Dependencies on Other Modules
- items, item_stock_balances/store-transactions (on-hand), purchase-orders/purchase_order_lines (rate), goods-receipt-notes (latest-GRN rate anchor).

## User Roles / Access
Read: any authenticated company user. No writes.

## Reports
This module *is* the report — per-item valuation, per-category subtotals, grand total value and item counts.

## Imports / Exports
None (rendered on screen; no file export in the API).

## Background Jobs
None.
