# Job Work Orders (JWSO)
**Module key:** `job-work-orders` · **Domain:** Job Work & Production Execution

## Purpose
Header + lines master for Job Work Sales Orders (JWSO / JWO) — customer orders where the client sends material (or a drawing) for us to process. Same shape as the Sales Orders module but without GST/type/cost-center/BOM, with client-material fields on the header and material-received fields instead of rate/PO-line on lines. Codes are server-authoritative in the `IN-JW-#####` series.

## Pages / Screens
- `job-work-orders` — list (one row per JWSO header with rolled-up line count / total qty / JC qty / earliest due).
- `job-work-orders/new` — create form (`job-work-order-form.tsx`).
- `job-work-orders/$id` — detail (`detail.tsx`, includes `jw-material-status.tsx`).
- `job-work-orders/$id/edit` — edit form.

## Database Tables
Owns/writes two tables (defined in `db/schema.ts`):

**`job_work_orders`** (L1178) — header.
- Key cols: `code` (unique `IN-JW-#####`), `jw_date`, `client_id` → clients, `customer_name` (snapshot of master name), `client_po_no`, `status` (`so_status` enum, default `open`), `remarks`, client-material fields (`client_material`, `client_material_qty`, `material_received_date`, `material_received_qty`).
- Indexes: unique `(company_id, code) where deleted_at is null`; `(company_id, client_id)`; `(company_id, status)`.
- Standard audit cols + `company_id` FK. RLS: `job_work_orders_company_read` (select if `company_id = current_company_id()`), `job_work_orders_manager_write` (all for admin/manager).

**`job_work_order_lines`** (L1231) — lines.
- Key cols: `job_work_order_id` FK (ON DELETE CASCADE), `line_no`, `item_id` → items (nullable), `item_code_text` (free text when unmatched), `part_name` (not null), `material`, `drawing_no`, `uom` (default NOS), `order_qty` (CHECK > 0), `rate`, `due_date`, `status` (`so_status`).
- Indexes: unique `(job_work_order_id, line_no) where deleted_at is null`; `(item_id)`. CHECK `order_qty > 0`. Same RLS pattern (company read / manager write).

Job Cards link back via `job_cards.source_jw_line_id` → `job_work_order_lines.id` (ON DELETE SET NULL).

## API Endpoints
Declared in `routes.ts`; all require an authenticated `req.user`.
- `GET /job-work-orders` — list (search/status/clientId/date filters, paginated).
- `GET /job-work-orders/:id` — full detail (header + lines).
- `POST /job-work-orders` — create (201). Write role.
- `PATCH /job-work-orders/:id` — update header and/or lines. Write role.
- `DELETE /job-work-orders/:id` — soft delete (204). Write role.

## Services / Key Functions
`service.ts` (public):
- `listJobWorkOrders(input, user)` → paginated list items with line + JC roll-up aggregates. One-row-per-header via LEFT JOIN subqueries; search matches header fields OR any line item-code/part-name via EXISTS.
- `getJobWorkOrder(id, user)` → header + ordered lines; reverse-resolves `item_id` → master code for display.
- `createJobWorkOrder(input, user)` → detail. **Transaction** wrapped in `withUniqueRetry` (retries on `IN-JW` code collision, SQLSTATE 23505). Generates next code, dup-checks, snapshots client name, resolves item codes, assigns line nos, emits `CREATE` activity log.
- `updateJobWorkOrder(id, input, user)` → detail. **Transaction**. Option-C merge: header always patched; lines merged only when `input.lines` present (`mergeLines` inserts/updates/soft-deletes). Emits `EDIT`.
- `softDeleteJobWorkOrder(id, user)` → `{ ok: true }`. **Transaction**. Soft-deletes lines then header; emits `DELETE`.
- Private helpers: `assertClientExists`, `resolveItemCodes`, `resolveItemCodesById`, `nextJwCode`, `assertItemIdsExist`, `resolveLineItemRefs`, `assignLineNos`, `mergeLines`.

## Entry Points
Web `apps/web/src/modules/job-work-orders/` (`api.ts`, `routes/{list,detail,edit}.tsx`). List row click opens detail; also reachable as JC source (via `job-cards/source-options`) and by `prod-jw-list`, `jwso-documents`, `jw-dc` which reference JWSO headers.

## Business Logic
- **Code generation:** server-authoritative `IN-JW-#####` = MAX(existing numeric suffix) + 1, zero-padded to 5. Caller-supplied code honoured but dup-checked. Race-guarded by `withUniqueRetry`.
- **Client snapshot:** when `client_id` is set/changed, `customer_name` is snapshotted from the client master (no free text).
- **Lines required:** create always requires ≥ 1 line (no Equipment exception unlike SO).
- **Item resolution:** a line with `item_id` stores the id and nulls `item_code_text`; a free-text `item_code_text` is resolved to a master item if a matching code exists, else kept as text. On read, code is surfaced back for display.
- **Merge (option-C):** on update, lines present in payload with a known `id` are updated; new ones inserted (line_no continues after surviving max); existing lines absent from payload are soft-deleted.
- **JWSO → JC linkage:** JWSO lines are a source for Job Cards. `job_cards.source_jw_line_id` links a JC to a JWSO line; list roll-up sums linked JC order_qty as `jcQty`.

## Dependencies on Other Modules
- `activity-log` (`emitActivityLog`).
- `clients`, `items` masters (validation + name/code snapshots).
- Consumed by `job-cards` (source line), `prod-jw-list`, `jwso-documents`, `jw-dc`.
- `lib/auth` (`requireWriteRole`), `lib/db-retry` (`withUniqueRetry`), `db/with-user-context` (RLS session).

## User Roles / Access
Read: any authenticated company user (RLS company read). Write (create/update/delete): admin/manager only (`requireWriteRole` + `manager_write` RLS policy).

## Reports
None owned. Feeds `prod-jw-list` aggregate and JC source options.

## Imports / Exports
None (no Excel import/export in this module). Zod schemas re-exported from `@innovic/shared` via `schema.ts`.

## Background Jobs
None.
