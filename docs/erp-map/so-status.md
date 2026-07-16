# SO Status Review
**Module key:** `so-status` · **Domain:** Sales & SO Analytics

## Purpose
Read-only detailed status review for a single Sales Order. Per SO line: 6 progress
chips (JC issued, PO raised, GRN received, QC accepted, produced, dispatched), a
linked Job Card table with op-level drill-down, and outsource-tracking alerts
(at-vendor qty, pending-PR ops, PR-raised count). For equipment SOs it adds a BOM
banner + BOM-items table with stock shortfall and existing-plan status. Ports
legacy `renderSOStatus` (HTML L4255).

## Pages / Screens
web routes under `apps/web/src/modules/so-status/routes/`:
- `detail.tsx` — path `sales-orders/$id/status` — SO status review embedded under the SO detail.
- `index.tsx` — path `so-status` — standalone entry (SO picker → status view).

## Database Tables
READ-ONLY. Reads: `sales_orders` (header/company gate), `sales_order_lines` + `items` (lines + code), `job_cards` (via `source_so_line_id`), `jc_ops`, `op_log`, `running_ops`, `purchase_order_lines` (PO-raised qty via `source_so_line_id`), `goods_receipt_note_lines` (received/QC-accepted qty via PO line), `delivery_challans` + `delivery_challan_lines` (dispatched qty — customer DCs, i.e. `purchase_order_id IS NULL`), plus for equipment SOs: `bom_masters`, `bom_master_lines`, `item_stock_balances`, `plans` (+ `job_cards` for plan JC code). Writes nothing.

## API Endpoints
`routes.ts` (auth required):
- `GET /so-status/:soId` — full per-line status + JC/op drill + equipment BOM items.

Access: any authenticated company user; RLS enforces isolation.

## Services / Key Functions
`service.ts`:
- `getSoStatus(soId, user)` → `SoStatusResponse` — three sequential batched rounds (JC + PO/GRN/Disp aggs → ops/logs/running → per-line assembly). Builds JC rollups via calc-engine, then per-line chips, outsource alerts, and (for equipment) a BOM-items table with shortfall + plan status.
- `buildEmptyResponse(header)` — private; SO with no lines returns zeroed chips.

Uses `lib/calc-engine`: `enrichOps`, `rollupJC`, `rollupSoLine`.

## Entry Points
`soStatusRoutes(app)`. Read-only, no cross-module writes.

## Business Logic
- **6 chips per line:** jcIssued (Σ linked JC order_qty), poRaised (Σ PO-line qty on this SO line), grnReceived (Σ GRN received qty via PO line), qcAccepted (Σ GRN qc_accepted qty), produced (calc-engine doneQty), dispatched (Σ customer-DC line qty). Each chip is `{qty, total}` where total is the order qty (or upstream qty).
- **Customer-dispatch filter:** DCs count only when `delivery_challans.purchase_order_id IS NULL` (OSP DCs carry a PO link and are excluded).
- **Outsource alert per line:** over all `op_type='outsource'` ops of the line's JCs — `atVendorQty` (Σ inputAvail−completed for `outsource_at_vendor`/`outsource_po_created`), `atVendorOpCount`, `pendingPrCount` (status `outsource_pending`, each also emitted in `pendingOps[]` for the UI's inline "PR Op" buttons), `prRaisedCount` (`outsource_pr_raised`).
- **Overall %:** `min(100, round(totalDone/totalQty × 100))`.
- **Equipment BOM items:** only when `type='equipment'` AND `bom_master_id` is a real UUID. Per BOM child: `totalNeed = qtyPerSet × equipmentQty`, `stockQty` from item_stock_balances, `shortfall = max(0, need−stock)`, plus existing non-cancelled, non-assembly plan status/code and JC code (bucketed by `bom_child_code`).
- SO `dueDate` is surfaced as null at header level (due dates live on lines).

## Dependencies on Other Modules
- **calc-engine** — JC/line rollups.
- Reads job-cards, jc-ops, op-log, running-ops, purchase-orders, goods-receipt-notes, delivery-challans, bom-master, store (item_stock_balances), plans data.

## User Roles / Access
Any authenticated company user (read-only). RLS handles company isolation.

## Reports
This module IS the SO Status Review report (single-SO drill).

## Imports / Exports
None.

## Background Jobs
None.
