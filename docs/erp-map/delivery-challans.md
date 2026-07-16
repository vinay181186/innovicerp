# Delivery Challans
**Module key:** `delivery-challans` · **Domain:** Dispatch, Finance & Design

## Purpose
Outward Delivery Challans (DC) for **outsource / OSP** movement — material sent to a vendor against a PO / outsource JC operation — plus the **receive-back** flow. Writes cascade atomically into `jc_ops` (sent/received qty + outsource status), the stock ledger (`store_transactions`), auto-NC on rejects, and the JC→SO completion cascade. T-040a (read), T-059a (outward write), T-059b (receive-back). Mirrors legacy `printChallan`.

## Pages / Screens
`apps/web/src/modules/delivery-challans/routes/`:
- **List** (`list.tsx`) — DC register with KPI summary (Total Dispatched / Entries / Items) and filters.
- **Create** (`create.tsx`) — outward DC against a PO + vendor.
- **Detail** (`detail.tsx`) — header, lines, receipts.
- **Receive** (`receive.tsx`) — record received / rejected qty against DC lines.

## Database Tables
Owned/written (`apps/api/src/db/schema.ts`):

- **`delivery_challans`** (outward header). Cols: `code`, `dc_date`, `purchase_order_id` (FK, set null), `po_code_text` (NOT NULL), `vendor_id` (FK → `vendors`, NOT NULL), `vendor_code_text`, `sales_order_line_id` (FK, set null), `so_ref_text`, `transport`, `status` (`dc_status` enum: `issued` | `received` | `cancelled`, default `issued`).
  - Indexes: unique `(company_id, code)`; `(company_id, dc_date)`; `(company_id, purchase_order_id)`; `(company_id, status)`; partial `(sales_order_line_id)`.
- **`delivery_challan_lines`**. Cols: `delivery_challan_id` (FK cascade), `line_no`, `item_id` (FK, NOT NULL), `item_code_text`, `item_name_text`, `qty` (numeric 12,2, CHECK `> 0`), `uom` (enum), `material_text`, `dc_remarks`, `purchase_order_line_id` (FK, set null).
  - Indexes: unique `(delivery_challan_id, line_no)`; `(item_id)`; partial `(purchase_order_line_id)`.
- **`delivery_challan_receipts`** (receive-back header, many per DC). Cols: `delivery_challan_id` (FK cascade), `receipt_code` (RCPT-<dcCode>-NN), `receipt_date`, `vendor_invoice_text`, `remarks`.
  - Indexes: unique `(company_id, receipt_code)`; `(delivery_challan_id)`; `(company_id, receipt_date)`.
- **`delivery_challan_receipt_lines`**. Cols: `receipt_id` (FK cascade), `delivery_challan_line_id` (FK cascade), `received_qty` (numeric), `rejected_qty` (numeric, default 0), `reject_reason`, `remarks`.
  - CHECKs: qtys ≥ 0; received+rejected > 0; `reject_reason` required when `rejected_qty > 0`.
  - Indexes: `(receipt_id)`; `(delivery_challan_line_id)`.

All four tables carry `company_id`, audit cols, `deleted_at`, RLS enabled. Policies: `*_company_read` (select in-company); `*_manager_write` (admin/manager writes in-company).

## API Endpoints
`routes.ts` — all require authentication.
- `GET /delivery-challans` — filtered list (search / status / vendor / PO / date range) + KPI summary.
- `GET /delivery-challans/:id` — header + lines + receipts.
- `POST /delivery-challans` → 201 — create outward DC (write role).
- `POST /delivery-challans/:id/cancel` — cancel DC (**admin only**).
- `POST /delivery-challans/:id/receive` → 201 — receive-back: auto receipt code, stock IN, jc_op flip, auto-NC on reject, JC→SO cascade (write role).

## Services / Key Functions
`service.ts` (public):
- `listDeliveryChallans(query, user)` → items + total + KPI summary (raw SQL joins to vendor/PO/SO).
- `getDeliveryChallan(id, user)` → `DeliveryChallanWithLines` (header + lines + nested receipts/lines).
- `createDeliveryChallan(input, user)` — **transactional**; write role. Dedup code, validate vendor/PO/SO-line/items, per-PO-line over-ship guard, insert header+lines, then cascades.
- `cancelDeliveryChallan(id, user)` — **transactional**; **admin only**. Reverses cascades.
- `receiveAgainstDeliveryChallan(id, input, user)` — **transactional**; write role. Receipt insert + cascades + status flip.

Cascade helpers live in `cascades.ts` (`writeStoreTxnOnDcIssue`, `applyOutwardToJcOp`, `reverseStoreTxnOnDcCancel`, `reverseOutwardFromJcOp`) and `receipt-cascades.ts` (`writeStoreTxnOnDcReceive`, `applyReceiveToJcOp`, `autoCreateNcFromOutsourceReject`, `dcHasActiveReceipts`, `isDcFullyReconciled`). Zod schemas in `schema.ts`; tests in `service.test.ts` / `routes.test.ts`.

## Entry Points
- API `deliveryChallansRoutes(app)`.
- Web hooks `apps/web/src/modules/delivery-challans/api.ts`; components/ + lib/.

## Business Logic
- **DC status machine:** `issued` (on create) → `received` (auto, when every outward line is fully reconciled by receipts) or `cancelled` (manual, admin).
- **Create (outward):** unique `code` per company; validates vendor, PO, SO line, and items exist in-company. Per PO line, cumulative sent (across non-cancelled DCs) + this DC's qty must not exceed the PO line qty (else `ConflictError`). `line_no` auto-assigned or fully supplied. Per line cascades: `writeStoreTxnOnDcIssue` (stock OUT) and, when linked to a PO line, `applyOutwardToJcOp` (bumps `jc_ops.sent_qty` / outsource status). Emits `DC_ISSUE` + `OP_OUTSOURCE_SENT`.
- **Cancel:** admin-only, destructive. Blocked if status is `cancelled` or `received`, or if any active receipts exist (must void receipts first — no UI today). Reverses stock ledger and jc_op outward state; sets `cancelled`. Emits `DC_CANCEL` + `OP_OUTSOURCE_REVERSED`.
- **Receive-back:** blocked if DC is `cancelled` or already `received`. Validates each input line belongs to the DC; per-line cumulative received+rejected across prior receipts + this receipt must not exceed the outward line qty. Generates `RCPT-<dcCode>-NN` (count+1, uniqueness retry loop). Per receipt line: stock IN for **good qty only** (rejects do NOT enter stock). Aggregates per PO line and calls `applyReceiveToJcOp` once per PO line (flips jc_op received/fully-received). Per rejected line (>0) with a PO line: `autoCreateNcFromOutsourceReject` opens an NC against the outsource jc_op (reported by the vendor). When `isDcFullyReconciled`, sets DC `received`. For each op that just became fully-received, runs `tryCascadeJcComplete` (JC→SO completion). Emits `DC_RECEIVE`, `OP_OUTSOURCE_RECEIVED`, `DC_COMPLETE`.

## Dependencies on Other Modules
- **Purchase Orders** — `purchase_orders` / `purchase_order_lines` (over-ship guard, PO-line linkage).
- **Vendors** — vendor validation + snapshot text.
- **Sales Orders** — `sales_order_lines` link + `so_ref_text`.
- **Job Cards / JC Ops** — `jc_ops` outsource cascades via `op-entry/sales-cascade` (`tryCascadeJcComplete`) and cascade helpers.
- **NC Register** — auto-NC on outsource reject.
- **Store / Inventory** — `store_transactions` ledger.
- **Activity Log** — `emitActivityLog`.

## User Roles / Access
- Read: any authenticated in-company user.
- Create / receive: `requireWriteRole` → **admin / manager**.
- Cancel: **admin only** (service-level check on top of RLS).

## Reports
- DC register list with KPI summary (Total Dispatched, Entries = DC line count, Items = distinct items), matching the active filter set.

## Imports / Exports
- No file import/export.

## Background Jobs
None — all cascades run synchronously inside the write transaction.
