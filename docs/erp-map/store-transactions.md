# Store Transactions (Stock Ledger)
**Module key:** `store-transactions` · **Domain:** Procurement & Store

## Purpose
The append-only stock ledger — the single source of truth for company item stock movement. Every in/out/adjust event is one immutable row (ADR-015 #4). This module is **read-only**: rows are written exclusively by other services' cascades (GRN QC accept, manual adjust, store issue, dispatch, JW in/out, production QC accept). On-hand per item is derived from this ledger via the `item_stock_balances` cache / `v_item_stock` view, maintained by a DB trigger. Mirrors legacy `renderStockLedger`.

## Pages / Screens
- `apps/web/src/modules/store-transactions/routes/list.tsx` — stock ledger list + KPI tiles (txn count / total in / total out / net / item count)

## Database Tables
**`store_transactions`** (owned; append-only) — schema.ts L1641
- Key cols: `txn_date`, `item_id` (FK items)/`item_code_text`, `txn_type` (`store_txn_type`: in/out/adjust), `qty` (>0), `source_type` (`store_txn_source_type`: grn_qc/manual_adjust/dispatch/jw_in/jw_out/qc_accept/other), `source_ref` (natural-key text, e.g. `IN-GRN-00001`), `stock_before`, `stock_after`, `remarks`.
- Note: **no `deleted_at`, no `updated_*`** — insert-only, created_at/created_by only.
- Indexes: `(company_id, item_id, txn_date)`; `(company_id, source_type, source_ref)`; `(company_id, txn_date)`. Check `qty > 0`.
- RLS: `company_read` (select), `manager_insert` (insert admin/manager) — **no UPDATE/DELETE policies** (append-only, like op_log).

**`item_stock_balances`** (related, schema.ts L1690) — `(company_id, item_id)` PK, `on_hand_qty`; sole writer is a SECURITY DEFINER AFTER-INSERT trigger on store_transactions. `v_item_stock` is a view over it.

## API Endpoints
routes.ts (authenticated):
- `GET /store-transactions` — ledger list (search, itemId, txnType, sourceType, fromDate, toDate) + summary
- `GET /store-transactions/item-balance/:itemId` — current on-hand for one item

No create/update/delete — writes happen only via service cascades in other modules.

## Services / Key Functions
service.ts (read-only):
- `listStoreTransactions(input, user)` → items + summary — raw SQL with item join; separate KPI summary query (count, total in, total out, net, distinct item count) over the same filter set.
- `getItemBalance(itemId, user)` → `{itemId, onHand}` — reads on-hand from `v_item_stock` (0 when no ledger rows).

Writers live elsewhere: `writeStoreTxnOnQcAccept` (goods-receipt-notes/cascades.ts, `grn_qc`), `adjustStock` (store-inventory, `manual_adjust`), `createStoreIssue` (store-issues, `other`), plus dispatch / JW / production-QC flows (`dispatch`/`jw_in`/`jw_out`/`qc_accept`).

## Entry Points
- `storeTransactionsRoutes` (Fastify). Central ledger read by store-inventory and stock-valuation; all stock-moving modules insert here.

## Business Logic
- **Append-only ledger:** no mutation; a correction is a new (reversing) row. `stock_before`/`stock_after` snapshot the running balance at write time.
- **Polymorphic source:** `source_type` + `source_ref` text tie a row back to its originating document without a hard FK (deferred until strong consistency needed).
- **On-hand derivation:** never a mutable column — computed from the ledger and cached in `item_stock_balances` by a trigger; readers use `v_item_stock`.
- **Concurrency:** writers lock the items row `FOR UPDATE` before reading before/after to serialize same-item movements.

## Dependencies on Other Modules
- items (subject), item_stock_balances/v_item_stock (derived on-hand). Written by: goods-receipt-notes, store-inventory, store-issues, dispatch, job-work (JW in/out), production QC.

## User Roles / Access
Read: any company user (`company_read`). Insert: admin/manager (`manager_insert`) — but only through service cascades, never a direct API. No update/delete for anyone.

## Reports
Stock-ledger KPI tiles (txn count, total in, total out, net, item count) across the filtered set; per-item balance lookup.

## Imports / Exports
None.

## Background Jobs
None in app code. The `item_stock_balances` cache is updated synchronously by a Postgres AFTER-INSERT trigger (SECURITY DEFINER) on every ledger insert.
