# Sales Orders
**Module key:** `sales-orders` · **Domain:** Sales & SO Analytics

## Purpose
The anchor CRUD module for customer Sales Orders (SO). Owns the SO header + lines
+ delivery-schedule milestones, server-authoritative SO-number generation, client/
item FK validation, the BOM-cascade trigger, and email/client-PO file references.
All SO analytics modules (`so-*`) read the tables this module writes.

## Pages / Screens
web routes under `apps/web/src/modules/sales-orders/routes/`:
- `list.tsx` — path `sales-orders` — SO master list (search, status/type/client/date filters, paginated).
- `detail.tsx` — path `sales-orders/$id` — SO detail: header, lines (with billed/JC qty), milestones, attached client-PO / email-reference files viewed inline.
- `edit.tsx` — paths `sales-orders/new` (create) and `sales-orders/$id/edit` (edit) — header + line + milestone form.

## Database Tables
Owned / written (from `apps/api/src/db/schema.ts`):

**`sales_orders`** (header)
- Key cols: `code` (text, e.g. `IN-SO-00001`), `so_date` (date), `client_id` (FK→clients, nullable), `customer_name` (text snapshot of master client name), `client_po_no`, `type` (`so_type` enum), `status` (`so_status` enum, default `open`), `gst_percent` numeric(5,2) default 18.00, `bom_master_id` (text), `bom_status`, `cost_center`, `remarks`.
- Unique: `sales_orders_company_code_uniq` on `(company_id, code) WHERE deleted_at IS NULL`.
- Indexes: `(company_id, client_id)`, `(company_id, status)`, `(company_id, so_date)` — all partial `WHERE deleted_at IS NULL`.
- FKs: `company_id`→companies, `client_id`→clients, `created_by`/`updated_by`→users.
- Standard audit cols + `company_id`. RLS: `sales_orders_company_read` (select for company) + `sales_orders_manager_write` (all — admin/manager only).

**`sales_order_lines`**
- Key cols: `sales_order_id` (FK→sales_orders ON DELETE cascade), `line_no` (int), `item_id` (FK→items, nullable), `item_code_text` (free text when item not resolved), `part_name` (notnull), `material`, `drawing_no`, `uom` (`uom` enum default NOS), `order_qty` (int, CHECK >0), `rate` numeric(12,2), `due_date`, `dispatched_qty` (int default 0, maintained by customer-dispatches), `client_po_line_no`, `status` (`so_status` default open), `source_bom_master_id` (FK→bom_masters, ON DELETE set null — drives BOM-8 cascade).
- Unique: `sales_order_lines_so_line_uniq` on `(sales_order_id, line_no) WHERE deleted_at IS NULL`.
- Indexes: `item_id`, `(company_id, status)`, `source_bom_master_id` (partial).
- RLS: company_read + manager_write (admin/manager).

**`so_milestones`** (SO-level delivery schedule / lots; ISSUE-015, migration 0056)
- Key cols: `sales_order_id` (FK cascade), `lot_no` (int), `qty` (int), `due_date`, `remarks`.
- Index: `so_milestones_so_idx` on `sales_order_id` (partial). RLS: company_read + manager_write.

Reads for the detail view also touch: `items` (item code), `job_cards` (JC qty per line via `source_so_line_id`), `invoices`/`invoice_lines` (billed qty per line, ADR-042), `file_registry` (client-PO / email-ref attachments, category `client_po`), `users` (createdBy name), `job_work_orders` (client-PO uniqueness guard).

## API Endpoints
`apps/api/src/modules/sales-orders/routes.ts` (all require authenticated user):
- `GET /sales-orders` — list with filters (search, status, type, clientId, fromDate, toDate, limit, offset). Read: any company user.
- `GET /sales-orders/next-code` — suggested next `IN-SO-#####`.
- `GET /sales-orders/:id` — SO detail (header + lines + milestones + billed/JC qty + client-PO file path).
- `POST /sales-orders` — create (201). Requires write role (`requireWriteRole`).
- `PATCH /sales-orders/:id` — update header/lines/milestones. Requires **admin** role (`requireAdminRole`).
- `DELETE /sales-orders/:id` — soft delete (204). Requires write role.

## Services / Key Functions
`service.ts` public functions:
- `listSalesOrders(query, user)` → `ListSalesOrdersResponse` — raw-SQL list joining line aggregates (count/qty/earliest due), JC qty (Σ job_cards.order_qty via source_so_line_id), and latest active client-PO file. Count via Drizzle (approximate under search).
- `getSalesOrder(id, user)` → `SalesOrderDetail` — header + lines (each with billedQty from invoice_lines, jcQty from job_cards) + milestones + clientPoFilePath.
- `getNextSoCode(user)` → `{ code }` — MAX+1 over `IN-SO-#####` series.
- `createSalesOrder(input, user)` → `SalesOrderDetail` — header+lines+milestones in one transaction (`withUserContext`), wrapped in `withUniqueRetry` for concurrent code collisions. Fires `cascadeBomToSoLine` (bom-master) per line with a BOM link, emits activity log.
- `updateSalesOrder(id, input, user)` → `SalesOrderDetail` — header patch + option-C merge of lines (`mergeLines`) and milestones (`mergeMilestones`).
- `softDeleteSalesOrder(id, user)` → `{ ok: true }` — soft-deletes lines then header, emits activity log.

Private helpers: `nextSoCode`, `assertClientExists` (snapshots master name), `resolveItemCodes`/`assertItemIdsExist`/`resolveLineItemRefs` (item FK resolution per ADR-012 #10), `assignLineNos`, `mergeLines`, `mergeMilestones`, `readMilestones`, `readClientPoFilePath`.

## Entry Points
Routes registered via `salesOrdersRoutes(app)`. Consumed by the web `api.ts` TanStack Query hooks. `cascadeBomToSoLine` (bom-master module) is invoked on create. `emitActivityLog` (activity-log module) records CREATE/EDIT/DELETE.

## Business Logic
Concrete rules:
- **SO code:** server-authoritative. Generated as `IN-SO-` + zero-padded (5) MAX+1 over existing `IN-SO-#####` codes in the company (regex `IN-SO-(\d+)`). Caller may override with an explicit `code`; explicit duplicate → `ConflictError`. Concurrent-create collisions retried in a fresh tx (`withUniqueRetry` on unique-violation 23505).
- **Client PO No. uniqueness:** on create, a non-empty `client_po_no` must be unique across BOTH `sales_orders` AND `job_work_orders` in the company (legacy `addSO` L12431). Hit → `ConflictError` naming the existing doc.
- **customer_name snapshot:** when `client_id` is set, `customer_name` is snapshotted from the master `clients.name` (not free text) on create and on client change during update.
- **Item resolution (ADR-012 #10):** a line supplies `item_id` OR `item_code_text`. `item_id` is trusted (validated exists+company). `item_code_text` is looked up in `items.code`; on hit → `(item_id, null)`, on miss → `(null, text)` — an unresolved code is NOT an error, the line loads with `item_id=null`.
- **Line numbers:** auto-assigned 1..N when none supplied; if any line supplies `line_no`, all must, and they must be unique within the batch.
- **Status enum (`so_status`):** `draft`, `open`, `closed`, `dispatched`, `cancelled`. Default `open`. Applies to both header and lines. There is no explicit status-transition state machine in this module — status is set directly; derived production status lives in the `so-*` analytics modules.
- **Type enum (`so_type`):** `component_manufacturing` (default), `equipment`, `with_material`.
- **Update merge (option C):** header-only PATCH leaves lines/milestones untouched. When `lines` (or `milestones`) is present: id-matched rows updated, new rows inserted (line_no auto = max surviving +1), existing rows absent from payload soft-deleted.
- **BOM cascade (BOM-8):** any freshly-inserted line with `source_bom_master_id` triggers `cascadeBomToSoLine`, walking the BOM's lines to spawn child JCs/PRs — in the same tx, so a cascade failure rolls back the SO.
- **Soft delete only:** delete cascades soft-delete to lines then header; no hard deletes.
- **Derived qtys on detail:** `billedQty` = Σ non-deleted invoice-line qty (ADR-042); `jcQty` = Σ job_cards.order_qty whose `source_so_line_id` = line.

## Dependencies on Other Modules
- **bom-master** — `cascadeBomToSoLine` on create.
- **activity-log** — `emitActivityLog`.
- **items** / **clients** — FK validation + name snapshot.
- **invoices** — billed-qty rollup.
- **job-cards** — JC-qty rollup.
- **file-registry** (shared table) — client-PO / email-reference attachments.
- **job-work-orders** — client-PO uniqueness cross-check.

## User Roles / Access
- Read: any authenticated company user (RLS `company_read`).
- Create / delete: write role (`requireWriteRole` — admin/manager).
- Edit (PATCH): **admin only** (`requireAdminRole`); managers can create but not edit existing SOs.
- DB RLS write policy restricts writes to admin/manager within company.

## Reports
None directly (this is the transactional CRUD module). Analytics/reporting served by the `so-*` sibling modules (costing, cycle-time, pending value, overview, etc.).

## Imports / Exports
- Zod schemas re-exported from `@innovic/shared` via `schema.ts` (create/update/list/detail/line/milestone).
- File attachments (client PO, email refs) registered in `file_registry` (category `client_po`), viewed inline on the detail page.
- No spreadsheet import/export in this module.

## Background Jobs
None.
