# Job Cards (JC)
**Module key:** `job-cards` · **Domain:** Job Work & Production Execution

## Purpose
A Job Card is a production batch on the shop floor for a specific item + quantity, carrying a routing of operations (`jc_ops`). JCs originate from a Sales Order line, a Job Work Order line, or a Plan. This module owns JC header + routing CRUD, a rich list joined to computed status, a source-options picker (open SO/JW lines with remaining balance), and an edit model that repopulates the modal (ops + QC docs).

## Pages / Screens
- `job-cards` — list (`list.tsx`, status badges, row write/print actions).
- `job-cards/new` — create (`new.tsx`, `job-card-form.tsx`).
- `job-cards/$id` — detail/status (`status.tsx`).
- `job-cards/$id/edit` — edit (`edit.tsx`).
- Components: `excel-jc-button`, `print-jc-button`, `jc-source-link`, `jc-status-badge`, `jc-status-content`, `jc-row-write-actions`.

## Database Tables
Owns **`job_cards`** and **`jc_ops`** (documented in detail in the jc-ops map); writes QC docs to shared `file_registry`.

**`job_cards`** (L699). Key cols: `code` (unique `IN-JC-YY-#####`), `jc_date`, `item_id` → items (not null), `order_qty` (CHECK > 0), `priority` (`jc_priority` enum, default normal), `due_date`, `drawing_file_path`, `remarks`, `source_so_line_id` → sales_order_lines (SET NULL), `source_jw_line_id` → job_work_order_lines (SET NULL), `source_legacy_ref`, `parent_nc_id` → nc_register (SET NULL, records NC-origin of a supplementary JC), `closed_at`. Indexes: unique `(company_id, code)`; `(company_id, item_id)`; `(company_id, due_date) where deleted_at is null AND closed_at is null`; `(company_id, jc_date)`; `(parent_nc_id)`. Checks: `order_qty > 0`; `num_nonnulls(source_so_line_id, source_jw_line_id) <= 1` (at most one source). RLS: `company_read` / `manager_write`.

`jc_ops` — see `jc-ops.md`.

## API Endpoints
`routes.ts`, all authenticated:
- `GET /job-cards` — list (search / status / date / machineId / operatorId filters, paginated).
- `POST /job-cards` — create (201). Write role.
- `GET /job-cards/source-options` — open SO/JW lines with remaining balance (static route, registered before `:id`).
- `GET /job-cards/:id/edit` — edit model (header + ops + QC docs).
- `GET /job-cards/:id` — single enriched JC (list-item shape).
- `PATCH /job-cards/:id` — update header + ops + QC docs. Write role.
- `DELETE /job-cards/:id` — soft delete. Admin only.

## Services / Key Functions
`service.ts` (public):
- `listJobCards(input, user)` → paginated enriched rows. One canonical raw-SQL join: `job_cards ⨝ items ⨝ v_jc_status ⨝ sales_order_lines/sales_orders ⨝ job_work_order_lines/job_work_orders ⨝ clients`; machineId/operatorId filters are EXISTS sub-selects; carries computed status, ops counts, source link, customer, last-op completed qty, running count.
- `getJobCard(id, user)` → one enriched row (404 via cheap exists-check first).
- `listJobCardSourceOptions(user)` → open SO + JW lines (UNION ALL) with `inJc` = Σ existing JC qty and `remaining = orderQty − inJc`; excludes closed orders.
- `getJobCardEditModel(id, user)` → header + ops (each with `hasStarted` flag) + QC docs.
- `nextJcCode(tx, companyId)` (exported, also used by Plans) → next `IN-JC-YY-#####`.
- `createJobCard(input, user)` → new JC (via `getJobCard`). **Transaction.** Write role.
- `updateJobCard(id, input, user)` → updated JC. **Transaction.** Write role.
- `deleteJobCard(id, user)` → `{ ok: true }`. **Transaction.** Admin role.
- `countJobCards(user)` (test helper).
- Private: `resolveItem`, `resolveCodeMap`, `assertLineBalance`, `validateOps`, `buildOpRows`, `registerQcDocs`, `startedOpIds`.

## Entry Points
Web `apps/web/src/modules/job-cards/` (`api.ts` + routes/components). Also created internally by Plan execution, NC rework, and BOM cascade — these bypass the direct-create guard.

## Business Logic
- **Code:** `IN-JC-YY-#####` (YY = 2-digit year), MAX+1 within the same year only, per company. Legacy `JC-PLN-…` / yearless codes ignored for numbering.
- **Direct-create governance:** `createJobCard` **rejects** SO/item-sourced JCs — those must come from Planning (execute a Plan). Manual creation is allowed **only** for Job Work (must have `source_jw_line_id`). Plan/NC/BOM insert JCs internally and bypass this entry point.
- **Line-balance guard (`assertLineBalance`):** `order_qty` cannot exceed the linked SO/JW line's remaining = `line.order_qty − Σ(other active JCs' order_qty on that line)` (excludes self on update).
- **Op validation (`validateOps`):** process op needs machine + operation; QC op needs operation; outsource op needs vendor. Machine/vendor codes resolved to master ids (missing = ValidationError).
- **Op-seq assignment:** ops numbered 1..N in payload order (`op_seq`). Op type per op: `process` | `qc` | `outsource`; QC forces `qc_required=true` and machine text `'QC'`.
- **Started-op guard on update (`startedOpIds`):** an op with any `op_log` row or a `running` session cannot be removed or have its type changed. Update parks kept ops' `op_seq` by +100000 to dodge the `(job_card_id, op_seq)` unique index while renumbering, then upserts to final order.
- **QC docs:** registered into `file_registry` (`category='qc-docs'`), deduped by storage path on update.
- **Status:** computed by `v_jc_status` / `v_jc_op_status` (SQL mirror of legacy calcEngine) — `no_ops`, in-progress, `complete`, etc. Not stored on the row.
- **Delete:** admin-only soft delete; ops soft-deleted too, but `op_log` rows preserved (FK is to still-existing `jc_ops.id`).

## Dependencies on Other Modules
- `items`, `machines`, `vendors`, `clients` masters; `sales-orders` / `job-work-orders` (source lines + balance); `nc-register` (`parent_nc_id`); `plans` (share `nextJcCode`); `activity-log`; shared `file_registry`. Consumed by `op-entry`, `jc-ops`, `machine-loading`, `prod-jw-list`, and status cascades.

## User Roles / Access
Read: authenticated company user. Create/Update: admin/manager (`requireWriteRole` + `manager_write` RLS). Delete: admin only (`requireAdminRole`).

## Reports
List view is the primary report surface (status, ops progress, running). Excel/print buttons exist on web.

## Imports / Exports
Web has `excel-jc-button` and `print-jc-button`; core JC writes go through the API service (no bulk import endpoint in this module).

## Background Jobs
None.
