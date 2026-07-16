# Purchase Requests (PR)
**Module key:** `purchase-requests` · **Domain:** Procurement & Store

## Purpose
Captures a request to procure an item before a formal Purchase Order exists. Single-table document (no lines — one item per PR, per ADR-015 #2). A PR is the head of the procurement chain: PR → PO → GRN. PRs can originate free-standing, or be linked to a source SO line / JC op (the shop floor asking for outsourced/job-work material). Status flow: `open → approved → po_created` (or `cancelled`).

## Pages / Screens
- `apps/web/src/modules/purchase-requests/routes/list.tsx` — PR list with search/status/vendor/date filters
- `.../routes/detail.tsx` — single-PR detail
- `.../routes/edit.tsx` — create/edit form
- (Batch-convert of OSP PRs → JW PO is driven from `apps/web/src/modules/outsource-jobs/routes/list.tsx`, calling the PO module's `from-pr-batch`.)

## Database Tables
**`purchase_requests`** (owned) — schema.ts L1295
- Key cols: `code` (unique per company), `pr_date`, `status` (`pr_status`: open/approved/po_created/cancelled), `pr_type` (`pr_type`: standard/jw_osp/service), `vendor_id`/`vendor_code_text`, `item_id`/`item_code_text`/`item_name`, `qty`, `est_cost` numeric(12,2), `required_date`, `source_jc_op_id` (FK jc_ops, set null), `source_so_line_id` (FK sales_order_lines, set null), `operation`, `approved_by`/`approved_at`, `po_id` (FK purchase_orders, set null), `po_created_at`.
- Indexes: unique `(company_id, code)` where not deleted; `(company_id, status)`; `(company_id, vendor_id)`; partial on `source_jc_op_id`.
- Checks: `qty > 0`; at least one of vendor_id/vendor_code_text; at least one of item_id/item_code_text.
- Standard audit cols + `company_id`. RLS: `company_read` (select any in company), `manager_write` (all — admin/manager only).

## API Endpoints
routes.ts (all require authenticated `req.user`):
- `GET /purchase-requests` — list (filters: search, status, prType, vendorId, sourceJcOpId, fromDate, toDate; paginated)
- `GET /purchase-requests/:id` — detail
- `POST /purchase-requests` — create (write role)
- `PATCH /purchase-requests/:id` — update (write role)
- `DELETE /purchase-requests/:id` — soft delete (write role)

Access: writes gated by `requireWriteRole` (admin/manager) plus RLS `manager_write`. There is no PR-approve endpoint here — approval + PO creation live in the purchase-orders module.

## Services / Key Functions
service.ts:
- `listPurchaseRequests(input, user)` → paginated list — raw SQL with joins to vendors/items/jc_ops/job_cards/purchase_orders for display fields.
- `getPurchaseRequest(id, user)` → single PR.
- `createPurchaseRequest(input, user)` → PR — dup-code check; FK asserts (vendor/item/jcOp/soLine); default `prType` = jw_osp if sourceJcOpId else standard; emits activity log.
- `updatePurchaseRequest(id, input, user)` → PR — partial field patch; re-asserts changed FKs; activity log EDIT.
- `softDeletePurchaseRequest(id, user)` → `{ok:true}` — **blocked if `po_id` is set** (a PO already carries the obligation; cancel instead). Activity log DELETE.

No multi-row transactions beyond single-row writes; each op runs in `withUserContext`.

## Entry Points
- API registered via `purchaseRequestsRoutes` (Fastify).
- Consumed downstream by purchase-orders (`createPurchaseOrderFromPr`, `createPurchaseOrderFromPrBatch`), which read the PR row and stamp `po_id`/`po_created_at`/`status='po_created'`.

## Business Logic
- **Chain position:** PR is step 1 of PR → PO → GRN.
- **Status machine:** create defaults to `open` (or caller-supplied). `approved` and `po_created` transitions are set by the PO module, not here. `po_created` is stamped atomically when a PO is generated from the PR.
- **PO-link guard:** once `po_id` is non-null, the PR cannot be deleted; the workaround is status `cancelled`.
- **Source linkage:** `source_jc_op_id` / `source_so_line_id` connect a PR back to the production/sales demand that raised it (used for OSP/job-work procurement).
- **prType inference:** if raised from a JC op and no type given, becomes `jw_osp`.

## Dependencies on Other Modules
- vendors, items (FK + existence asserts), jc-ops, sales-orders (source line asserts), purchase-orders (downstream consumer + `po_id` back-ref), activity-log (audit).

## User Roles / Access
Read: any authenticated user in the company. Write (create/update/delete): admin or manager (`requireWriteRole` + RLS `manager_write`). Procurement-role users are not separately privileged here — writes are manager/admin.

## Reports
None dedicated. List view provides status/vendor/date filtering; OSP PRs feed the outsource-jobs screen.

## Imports / Exports
None (no Excel import/export in this module).

## Background Jobs
None.
