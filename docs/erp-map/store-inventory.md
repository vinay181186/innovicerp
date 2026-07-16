# Store / Inventory
**Module key:** `store-inventory` · **Domain:** Procurement & Store

## Purpose
Per-item stock rollup screen: current on-hand + open-PO pending (on order) + open-JC pending (manufacturing pending) + min-stock/low-stock flags. Read view over the item master joined to the stock cache, PO pipeline and open job cards. Also exposes two write actions: manual stock adjust (± with reason) and set min-stock qty. Mirrors legacy `renderStore`.

## Pages / Screens
- `apps/web/src/modules/store-inventory/routes/list.tsx` — inventory table + stat tiles (total items / total pieces / in-stock / low-stock / zero-stock), with low/zero filters

## Database Tables
No owned tables. Reads:
- `items` (master; **writes** `min_stock_qty` via set-min action)
- `v_item_stock` / `item_stock_balances` — current on-hand cache (maintained by store_transactions trigger)
- `purchase_order_lines` + `purchase_orders` + `goods_receipt_note_lines` — open-PO pending (qty − received) for non-closed POs
- `job_cards` + `v_jc_status` + `op_log` + `jc_ops` — open-JC pending (order_qty − completed) for jobs not complete/closed
- **Writes** `store_transactions` (`source_type='manual_adjust'`) for stock adjustments.

## API Endpoints
routes.ts (authenticated):
- `GET /store-inventory` — rollup list (search, filter=all/low/zero)
- `POST /store-inventory/adjust` — manual + / − adjustment (with reason)
- `POST /store-inventory/set-min` — set item min-stock qty

## Services / Key Functions
service.ts:
- `listStoreInventory(input, user)` → rows + summary — one CTE query (`jc_open`, `po_pending`) joined to items + `v_item_stock`; computes `lowStock = minQty>0 && inStock<=minQty`; server-side low/zero filter; summary tiles always reflect the full master.
- `adjustStock(input, user)` → `{ok, stockAfter}` — **transaction**: locks items row `FOR UPDATE`, reads on-hand from `v_item_stock`, computes stock_after (add/remove), **rejects if result < 0**, inserts a `store_transactions` row (`in`/`out`, `source_type='manual_adjust'`, stock_before/after, reason in remarks).
- `setMinStock(input, user)` → `{ok, minQty}` — updates `items.min_stock_qty`.

## Entry Points
- `storeInventoryRoutes` (Fastify). Aggregation read across items/PO/GRN/JC; writes only via store_transactions ledger + item min-stock field.

## Business Logic
- **On-hand** comes from the `store_transactions`-derived cache (`v_item_stock` / `item_stock_balances`), never a mutable stock column.
- **On-order (PO pending):** Σ over open (non-closed) PO lines of `max(0, qty − received)` for the item.
- **Mfg pending (JC open):** Σ over job cards not complete/closed of `max(0, order_qty − completed op qty)`.
- **Low-stock:** flagged when a positive min-qty is set and on-hand ≤ min.
- **Manual adjust** is the only app path that writes a `manual_adjust` ledger row; it cannot drive stock negative. Reason is mandatory (stored in remarks).
- Stat tiles reflect the whole master regardless of active filter (clicking a tile sets the filter).

## Dependencies on Other Modules
- items (master + min-stock write), store-transactions (adjust ledger + on-hand source), purchase-orders/goods-receipt-notes (on-order pending), job-cards/jc-ops/op-log (mfg pending).

## User Roles / Access
Read: any company user. Adjust / set-min: gated by `store_transactions` insert policy (admin/manager) and `items` write RLS respectively. (Service relies on RLS rather than an explicit role check.)

## Reports
Live inventory rollup with stat tiles. Low-stock and zero-stock views double as reorder/shortage reports.

## Imports / Exports
None.

## Background Jobs
None. On-hand cache updated by the DB trigger on `store_transactions` inserts.
