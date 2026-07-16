# JW Delivery Challans (Outward / Inward)
**Module key:** `jw-dc` · **Domain:** Job Work & Production Execution

## Purpose
Delivery Challans for outsourced Job Work. **Outward** = returnable gate pass when sending material out to a Job-Work vendor against a Job-Work Purchase Order. **Inward** = receiving processed/returned material back. Each DC line moves stock: outward decrements item stock (`store_transactions` OUT / `jw_out`), inward OK-qty increments it (IN / `jw_in`). Rejected qty on inward is recorded (downstream NC integration deferred). Mirrors legacy `renderJWDC` / `_jwdcNewOutward` / `_jwdcNewInward`.

## Pages / Screens
- `jw-dc` — list (`list.tsx`); outward DCs with per-DC sent/returned/pending totals + return status.
- `jw-dc/$id` — outward detail (`detail.tsx`) with lines and per-line already-returned/pending.
(Inward is created against an outward DC; no standalone inward route present.)

## Database Tables
Owns 4 tables (`db/schema.ts`):

**`jw_dc_outward`** (L3061) — outward header. Cols: `code` (unique `JWDC-OUT-####`), `dc_date`, `purchase_order_id` → purchase_orders (SET NULL), `jwpo_code_text`, `vendor_id` → vendors (SET NULL), `vendor_code_text`, `vendor_name_text` (snapshot), `vehicle_no`, `remarks`. Indexes: unique `(company_id, code)`; `(company_id, dc_date)`; `(company_id, purchase_order_id)`; `(company_id, vendor_id)`.

**`jw_dc_outward_lines`** (L3116). Cols: `jw_dc_outward_id` FK (CASCADE), `line_no`, `purchase_order_line_id` → purchase_order_lines (SET NULL), `item_id` (SET NULL), `item_code_text` (not null), `item_name_text`, `process_text`, `po_qty`, `sent_qty` (not null), `store_transaction_id` → store_transactions (SET NULL). Indexes: `(jw_dc_outward_id, line_no)`; `(purchase_order_line_id)`.

**`jw_dc_inward`** (L3172). Cols: `code` (unique `JWIN-####`), `inward_date`, `jw_dc_outward_id` FK (RESTRICT — cannot delete outward with inwards), `dc_code_text`, `vendor_challan_no`, `vehicle_no`, `remarks`. Indexes: unique `(company_id, code)`; `(company_id, inward_date)`; `(company_id, jw_dc_outward_id)`.

**`jw_dc_inward_lines`** (L3222). Cols: `jw_dc_inward_id` FK (CASCADE), `jw_dc_outward_line_id` FK (RESTRICT), `item_id` (SET NULL), `item_code_text` (not null), `item_name_text`, `process_text`, `sent_qty`, `received_qty` (not null), `ok_qty`, `rejected_qty`, `remarks`, `store_transaction_id` (SET NULL). Indexes: `(jw_dc_inward_id)`; `(jw_dc_outward_line_id)`.

All four have `company_id` + standard audit cols + soft delete + `company_read` / `manager_write` RLS.

## API Endpoints
`routes.ts`, all authenticated:
- `GET /jw-dc/outward` — list outward (search/vendorId/purchaseOrderId/returnStatus filters, paginated).
- `GET /jw-dc/outward/:id` — outward detail with lines + return progress.
- `GET /jw-dc/po-lines/:poId` — PO lines available to dispatch (for the new-outward modal); requires a `job_work` PO.
- `POST /jw-dc/outward` — create outward (201).
- `GET /jw-dc/inward` — list inward (search / jwDcOutwardId filter, paginated).
- `POST /jw-dc/inward` — create inward (201).

## Services / Key Functions
`service.ts` (public):
- `listJwDcOutward(input, user)` → outward list; a `return_stats` CTE computes total sent / returned / pending and derives `returnStatus` (`out` | `partial` | `fully_returned`).
- `getJwDcOutwardDetail(id, user)` → header + lines with per-line already-returned/pending.
- `getJwDcPoLines(poId, user)` → dispatchable PO lines with `available = po_qty − alreadySent`; validates the PO is `poType='job_work'`.
- `createJwDcOutward(input, user)` → **Transaction**. Validates PO type + per-line available, locks item rows `FOR UPDATE`, snapshots vendor name, generates `JWDC-OUT-####`, inserts header + lines, and for each item line emits a `store_transactions` OUT (`jw_out`) with stock before/after, storing the txn id on the line.
- `listJwDcInward(input, user)` → inward list with received/ok/rejected totals.
- `createJwDcInward(input, user)` → **Transaction**. Validates each line's `received_qty ≤ pending` (sent − already-returned), locks items, generates `JWIN-####`, inserts header + lines, and for `ok_qty > 0` emits a `store_transactions` IN (`jw_in`) restoring stock.
- Private: `nextOutwardCode`, `nextInwardCode`.

## Entry Points
Web `apps/web/src/modules/jw-dc/` (`api.ts`, `routes/{list,detail}.tsx`). Outward dispatch starts from a Job-Work PO (via `po-lines/:poId`); inward is created against an existing outward DC.

## Business Logic
- **Codes:** outward `JWDC-OUT-####`, inward `JWIN-####`, both MAX+1 per company via regexp on existing codes, zero-padded to 4.
- **Outward guard:** send qty per line cannot exceed PO-line available (`po_qty − Σ sent`). PO must be Job Work type. Conflict (23505-style) raised as `ConflictError`.
- **Inward guard:** received qty per line cannot exceed pending on the source outward line (`sent − Σ returned`). Inward FK to outward is RESTRICT.
- **Stock cascade:** outward line → `items` stock down via `store_transactions(txn_type='out', source_type='jw_out')`; inward OK qty → stock up via `('in','jw_in')`. Rejected qty stored only. Item rows locked `FOR UPDATE` before stock math; `stock_before`/`stock_after` read from `v_item_stock`.
- **Return status:** derived per DC from sent vs returned totals.

## Dependencies on Other Modules
- `purchase-orders` / `purchase_order_lines` (dispatch source; must be `job_work`).
- `store-transactions` (stock ledger), `items` (stock + lock), `vendors` (name snapshot).
- `db/with-user-context` for RLS.

## User Roles / Access
Read: authenticated company user. Write: admin/manager (`manager_write` RLS; note: service create functions rely on RLS rather than an explicit `requireWriteRole` call).

## Reports
None owned; return-status roll-ups shown in list.

## Imports / Exports
None.

## Background Jobs
None. NC integration for inward rejects is deferred.
