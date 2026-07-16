# Purchase Orders (PO)
**Module key:** `purchase-orders` · **Domain:** Procurement & Store

## Purpose
Formal order to a vendor. Header + lines (per ADR-015 #1). Step 2 of PR → PO → GRN. Supports direct creation, single-PR conversion, and batch conversion of multiple outsource-processing (OSP) PRs into one job-work PO. Carries an approval workflow with per-approver value ceilings, and a received-qty/status ladder driven by downstream GRNs.

## Pages / Screens
- `apps/web/src/modules/purchase-orders/routes/list.tsx` — PO list (search/status/type/vendor/date)
- `.../routes/detail.tsx` — header + lines, approve/reject actions
- `.../routes/edit.tsx` — create/edit
- `.../routes/from-pr.tsx` — convert a PR to a PO

## Database Tables
**`purchase_orders`** (owned) — schema.ts L1371
- Key cols: `code` (unique per company, auto `IN-PO-#####`), `po_date`, `po_type` (`po_type`: standard/job_work/outsource/service), `vendor_id`/`vendor_code_text`, `status` (`po_status`: draft/open/partial/qc_pending/closed/cancelled), `due_date`, `tax_type`, `sgst_pct`/`cgst_pct`/`igst_pct` numeric(5,2), `pr_code_text`, `approved_by`/`approved_at`/`approval_remarks`, `rejected_by`/`rejected_at`/`rejection_reason`, `remarks`.
- Indexes: unique `(company_id, code)`; `(company_id, vendor_id)`; `(company_id, status)`; `(company_id, po_date)` — all where not deleted.

**`purchase_order_lines`** (owned) — schema.ts L1434
- Key cols: `purchase_order_id` (FK, cascade), `line_no`, `item_id`/`item_code_text`/`item_name`, `qty`, `rate` numeric(12,2), `received_qty` (default 0, maintained by GRN cascade), `due_date`, `source_so_line_id`, `source_jc_op_id`, `line_remarks`.
- Indexes: unique `(purchase_order_id, line_no)` where not deleted; item; source SO-line; source JC-op.
- Checks: `qty > 0`; `received_qty >= 0 AND <= qty + 10%` (allows legitimate over-receipt).

Both tables: standard audit + `company_id`; RLS `company_read` + `manager_write`.

## API Endpoints
routes.ts (authenticated):
- `GET /purchase-orders` — list (search, status, poType, vendorId, fromDate, toDate)
- `GET /purchase-orders/:id` — detail (header + lines + vendor name)
- `POST /purchase-orders` — create direct (write role) → 201
- `POST /purchase-orders/from-pr` — convert one PR → single-line PO (write role) → 201
- `POST /purchase-orders/from-pr-batch` — batch club N OSP PRs → one JW PO (write role) → 201
- `PATCH /purchase-orders/:id` — update header + optional line merge (write role)
- `DELETE /purchase-orders/:id` — soft delete (write role)
- `POST /purchase-orders/:id/approve` — approve draft PO (approver/admin, value-limit gated)
- `POST /purchase-orders/:id/reject` — reject draft PO with reason (approver/admin)

## Services / Key Functions
service.ts:
- `listPurchaseOrders` / `getPurchaseOrder` — reads with vendor/item joins + line aggregates (lineCount, totalQty, receivedQty).
- `createPurchaseOrder(input, user)` → detail — auto code `IN-PO-#####` if blank; initial status from `approval_config.poApproval` (draft if approval on, else open); inserts header + lines in one **transaction**; resolves item codes → ids; activity log CREATE.
- `updatePurchaseOrder(id, input, user)` → detail — header patch; if `lines` present, `mergeLines` (insert/update/soft-delete). **`received_qty` is never rewritten from the form** — only the GRN cascade touches it.
- `mergeLines(...)` — option-C merge, assigns line_nos, soft-deletes absent lines.
- `softDeletePurchaseOrder(id, user)` — soft-deletes header + lines (transaction).
- `createPurchaseOrderFromPr(input, user)` → detail — validates PR is open/approved (not po_created/cancelled), builds single-line PO (status `open`), stamps PR `po_id`/`po_created_at`/`status='po_created'`; two activity logs (PO CREATE + PR_CONVERT). **Transaction.**
- `createPurchaseOrderFromPrBatch(input, user)` → detail — clubs many OSP PRs into one JW PO, one line per PR, per-line rate overrides, stamps every PR; PO CREATE + one PR_CONVERT per PR. **Transaction.**
- `approvePurchaseOrder(id, remarks, user)` — draft→open; approver eligibility via `approval_config.po_approvers` (admins bypass); **value ceiling** = user's `approval_limit` else `po_manager_limit` else ₹100,000 default; PO value = Σ(qty×rate), no tax.
- `rejectPurchaseOrder(id, reason, user)` — draft→cancelled with reason.

## Entry Points
- `purchaseOrdersRoutes` (Fastify).
- Downstream: goods-receipt-notes reads PO/PO-lines and cascades back into `received_qty` + PO `status`. store-inventory & stock-valuation read PO lines for on-order / rate.

## Business Logic
- **Chain:** PR → **PO** → GRN.
- **Status machine (`recalcPoHeaderStatus`, in GRN cascades):** never downgrades `cancelled`/`draft`. Once opened: all lines fully received → `closed` (if all GRN lines QC-completed) or `qc_pending`; some received → `partial`; none → `open`.
- **Approval:** `poApproval` config decides whether new POs start `draft` (need approval) or `open`. Only draft POs can be approved/rejected. Non-admin approvers face a rupee ceiling.
- **Partial receipts & rollup:** `received_qty` per line is the SUM of non-deleted GRN line `received_qty`; recomputed on every GRN write/delete. Over-receipt allowed to +10% (DB check).
- **From-PR:** PRs convert straight to `open` POs (skip draft). PR gets `po_created`.

## Dependencies on Other Modules
- purchase-requests (source + back-ref), vendors, items, approval-config (poApproval/po_approvers/po_manager_limit), users (approval_limit), sales-orders / jc-ops (source line refs), activity-log, goods-receipt-notes (cascade writer of received_qty/status), outsource-jobs (batch-convert UI).

## User Roles / Access
Read: any company user. Create/update/delete: admin/manager (`requireWriteRole` + RLS). Approve/reject: admins (unlimited) or users listed in `approval_config.po_approvers`, subject to value ceiling for non-admins.

## Reports
List aggregates (line count, ordered vs received qty). Feeds store-inventory "on PO" pending and stock-valuation rate lookup.

## Imports / Exports
None.

## Background Jobs
None. All cascades run synchronously in the GRN write transaction.
