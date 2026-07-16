# Service Purchase Orders (Service PO / SPO)
**Module key:** `service-pos` · **Domain:** Procurement & Store

## Purpose
Non-inventory purchase orders — labour, maintenance, calibration, consultancy and other expenses that do not touch item stock. Header + free-text lines (description/qty/rate). Distinct from standard POs: no items, no GRN, no stock movement. Has its own approval step (admin-only). Mirror of legacy `renderServicePO`.

## Pages / Screens
- `apps/web/src/modules/service-pos/routes/list.tsx` — SPO list (status/vendor/date/search)
- `.../routes/detail.tsx` — header + lines, approve action
- `.../routes/new.tsx` — create form

## Database Tables
**`service_pos`** (owned) — schema.ts L4877
- Key cols: `spo_no` (unique per company), `spo_date`, `vendor_id`/`vendor_code_text`, `expense_head` (default 'Other'), `cost_center` (`service_po_cost_center`: so/general), `so_ref_id` (FK sales_orders)/`so_no_text`, `subtotal`/`tax_amount`/`total` numeric(14,2), `tax_type` (`service_po_tax_type`: sgst_cgst/igst), `gst_pct` numeric(5,2) default 18, `payment_terms` (default 'Immediate'), `remarks`, `status` (`service_po_status`: draft/pending/approved/completed/cancelled), `approved_by`/`approved_at`.
- Indexes: unique `(company_id, spo_no)`; `(company_id, status)`; `(company_id, spo_date)`; vendor — all where not deleted.

**`service_po_lines`** (owned) — schema.ts L4934
- Key cols: `service_po_id` (FK, cascade), `line_no`, `description`, `qty` numeric(12,2) default 1, `rate` numeric(14,2), `amount` numeric(14,2).
- Index: unique `(service_po_id, line_no)`. (Lines are hard-deleted/re-inserted on update — no `deleted_at` on lines.)

Both: `company_id` + audit; RLS `company_read` + `manager_write`.

## API Endpoints
routes.ts (authenticated):
- `GET /service-pos` — list (status, vendorId, fromDate, toDate, search)
- `GET /service-pos/:id` — detail (header + lines + vendor name)
- `POST /service-pos` — create (write role) → 201
- `PATCH /service-pos/:id` — update (write role)
- `POST /service-pos/:id/approve` — approve (admin role only)
- `DELETE /service-pos/:id` — soft delete (write role)

## Services / Key Functions
service.ts:
- `listServicePos` / `getServicePo` — vendor join + per-SPO line count.
- `computeTotals({lines, gstPct})` — subtotal = Σ(qty×rate), taxAmount = subtotal×gst%, total = subtotal+tax.
- `createServicePo(input, user)` → detail — dup `spo_no` check, vendor existence check, computes totals, inserts header + lines in one **transaction**; activity log CREATE.
- `updateServicePo(id, input, user)` → detail — **locked** if status is approved/completed/cancelled (only draft/pending editable); recomputes totals if lines provided; **replaces lines** (delete + re-insert); activity log EDIT.
- `approveServicePo(id, user)` — `requireAdminRole`; only `pending` → `approved`, stamps approved_by/at; activity log APPROVE.
- `softDeleteServicePo(id, user)` — sets deleted_at; activity log DELETE.

## Entry Points
- `servicePosRoutes` (Fastify). Standalone expense module; no downstream cascade. Optional `so_ref_id` links spend to a Sales Order for costing context.

## Business Logic
- **No stock impact** — service POs never write `store_transactions`; there is no GRN for them.
- **Status machine:** draft/pending → (admin) approved; completed/cancelled are terminal. Edits blocked once approved/completed/cancelled.
- **Approval is admin-only** (unlike standard PO which allows configured approvers) and requires status `pending`.
- **Totals** always server-computed from lines + gst%; frontend values are ignored.
- **Cost center** tags spend as SO-linked (`so`) or `general`.

## Dependencies on Other Modules
- vendors (existence check + name), sales-orders (optional `so_ref_id`), activity-log.

## User Roles / Access
Read: any company user. Create/update/delete: admin/manager (`requireWriteRole`). Approve: **admin only** (`requireAdminRole`).

## Reports
List provides status/date/vendor filtering and totals; can be tied to SO for expense attribution via `so_ref_id`/`cost_center`.

## Imports / Exports
None.

## Background Jobs
None.
