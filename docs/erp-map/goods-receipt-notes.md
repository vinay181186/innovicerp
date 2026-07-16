# Goods Receipt Notes (GRN)
**Module key:** `goods-receipt-notes` · **Domain:** Procurement & Store

## Purpose
Records material received against a Purchase Order (step 3 of PR → PO → GRN). Header + lines, with **inline incoming-QC** fields per line (ADR-015 #8). GRN is the pivot where procurement meets inventory: on a line's QC transition to `completed`, an `in` store-transaction is written and item stock rises. Every GRN write also cascades back into PO line `received_qty` and PO header status.

## Pages / Screens
- `apps/web/src/modules/goods-receipt-notes/routes/list.tsx` — GRN list + 4-tile KPI strip (total / QC-pending / QC-cleared / today)
- `.../routes/detail.tsx` — header + lines + QC info
- `.../routes/edit.tsx` — create/edit with per-line receipt + QC

## Database Tables
**`goods_receipt_notes`** (owned) — schema.ts L1502
- Key cols: `code` (unique per company, auto `IN-GRN-#####`), `grn_date`, `purchase_order_id` (FK, set null)/`po_code_text`, `vendor_id`/`vendor_code_text`, `dc_no`, `invoice_no`, `remarks`.
- Indexes: unique `(company_id, code)`; `(company_id, purchase_order_id)`; `(company_id, vendor_id)`; `(company_id, grn_date)` — where not deleted.

**`goods_receipt_note_lines`** (owned) — schema.ts L1557
- Key cols: `goods_receipt_note_id` (FK, cascade), `line_no`, `purchase_order_line_id` (FK, set null), `item_id`/`item_code_text`/`item_name`, `received_qty`, `dc_ref_no`, `qc_status` (`grn_qc_status`: pending/in_progress/completed), `qc_accepted_qty`, `qc_rejected_qty`, `qc_date`, `qc_remarks`, `qc_inspected_by` (FK users), `qc_report_path`/`qc_report_name` (Storage attachment).
- Indexes: unique `(grn_id, line_no)`; po-line; item; `(company_id, qc_status)` — where not deleted.
- Checks: received/accepted/rejected all `>= 0`; `qc_accepted_qty + qc_rejected_qty <= received_qty`.
- RLS: `company_read`, `manager_write`, plus **`qc_update`** (role `qc` may update QC fields — column-level GRANT pinned in hand-written migration).

Both: `company_id` + audit; header RLS `company_read`+`manager_write`.

## API Endpoints
routes.ts (authenticated):
- `GET /goods-receipt-notes` — list (search, vendorId, purchaseOrderId, qcStatus, fromDate, toDate) + summary
- `GET /goods-receipt-notes/:id` — detail (header + lines, resolved vendor/po/item display)
- `POST /goods-receipt-notes` — create (write role) → 201
- `PATCH /goods-receipt-notes/:id` — update header + optional line merge (write role)
- `DELETE /goods-receipt-notes/:id` — soft delete (write role, blocked if any line QC-completed)

## Services / Key Functions
service.ts + cascades.ts:
- `listGoodsReceiptNotes` — raw SQL, per-GRN line aggregates + separate KPI summary query.
- `getGoodsReceiptNote(id, user)` — header + lines with joined vendor/po/item display values.
- `createGoodsReceiptNote(input, user)` → detail — auto `IN-GRN-#####`; FK asserts (vendor/PO/items/PO-lines); inserts header + lines; **`runCascades`**; QC-completed lines stamp `qc_inspected_by`. **Transaction.**
- `updateGoodsReceiptNote(id, input, user)` — header patch + `mergeLines`.
- `mergeLines(...)` — insert/update/soft-delete; **blocks QC-field changes on already-completed lines** and blocks soft-deleting completed lines (raise ConflictError — must create a reversing GRN line); tracks touched PO lines/headers and fires cascades.
- **Cascades (cascades.ts), all in the caller's tx:**
  - `recalcPoLineReceivedQty(tx, poLineId)` — sets PO line `received_qty` = Σ non-deleted GRN line received_qty.
  - `recalcPoHeaderStatus(tx, poId)` — recomputes PO status (open/partial/qc_pending/closed); never touches cancelled/draft.
  - `writeStoreTxnOnQcAccept({...})` — on non-completed→completed with accepted qty>0 and resolvable item_id: locks the items row `FOR UPDATE`, reads on-hand from `v_item_stock`, inserts a `store_transactions` row (`txn_type='in'`, `source_type='grn_qc'`, stock_before/after).
- `softDeleteGoodsReceiptNote(id, user)` — blocked if any line QC-completed; soft-deletes, then recomputes PO line qty + header status.

## Entry Points
- `goodsReceiptNotesRoutes` (Fastify). Reads purchase-orders/PO-lines; writes into `store_transactions` (which the item_stock_balances trigger materializes) and mutates PO qty/status.

## Business Logic
- **Chain:** PR → PO → **GRN**.
- **Partial receipts & rollup:** many GRNs per PO; PO line `received_qty` is always the recomputed sum — never form-driven.
- **Inline QC:** each line carries its own QC status/accepted/rejected/report. Stock only moves on the completed transition, and only for the accepted qty; a fully-rejected line writes no ledger row.
- **Immutability after QC:** QC-completed lines cannot be edited or removed — reversal is a new (negative) GRN line. GRN with any completed line cannot be deleted.
- **Free-text items** (no item_id) get no stock tracking by design (`v_item_stock` filters item_id IS NOT NULL).
- **Stock serialization:** the items-row `FOR UPDATE` lock serializes concurrent QC accepts on the same item.

## Dependencies on Other Modules
- purchase-orders / purchase_order_lines (received_qty + status cascade), vendors, items, store-transactions (ledger writer), item_stock_balances / v_item_stock (stock source), users (qc_inspected_by), activity-log, incoming-qc (shares the GRN-line QC fields).

## User Roles / Access
Read: any company user. Create/update/delete: admin/manager (`requireWriteRole` + RLS). QC-field updates additionally permitted to role `qc` via `qc_update` policy. Store-transaction inserts require admin/manager (insert policy).

## Reports
KPI summary tiles (total, QC-pending, QC-cleared, today) computed across the filtered set. Per-GRN aggregates: received qty, QC accepted/rejected, pending count.

## Imports / Exports
QC report attachments per line (`qc_report_path`/`qc_report_name`, Supabase Storage `qc-docs` bucket). No Excel import/export.

## Background Jobs
None — cascades run synchronously in the write transaction. Item stock cache maintained by a DB AFTER-INSERT trigger on `store_transactions` (SECURITY DEFINER), not app code.
