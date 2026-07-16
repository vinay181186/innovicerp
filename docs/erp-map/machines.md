# Machines (Machine Master)
**Module key:** `machines` · **Domain:** Master Data

## Purpose
Master list of production machines/work centres with capacity, shift, live status, and an hourly rate. Referenced by machine op-entry, machine loading/scheduling, and SO costing (machine-time cost). Codes are entered manually (no auto-generation).

## Pages / Screens
`apps/web/src/modules/machines/routes/`:
- `list.tsx` — `/machines` Machine Master list (search on code/name, status filter, paginated).
- `detail.tsx` — read view of a single machine.
- `edit.tsx` — create/edit form (name, type, capacity/shift, shifts/day, status, hour rate).

## Database Tables
- **`machines`** (owned) — `id`, `company_id` (FK), `code`, `name`, `machine_type`, `capacity_per_shift` (int), `shifts_per_day` (int, default 1), `status` (text, default `Idle`), `hour_rate` numeric(12,2) (₹/hr, migration 0050), audit columns, `deleted_at`.
  - Unique: `machines_company_code_uniq` on `(company_id, code)` where not deleted. Indexes: `machines_company_id_idx`, `machines_company_status_idx` (both where not deleted).
  - RLS: `machines_company_read` (same company); `machines_manager_write` (admin/manager AND same company).

## API Endpoints
- `GET /machines` — list (search, status filter).
- `GET /machines/:id` — fetch one.
- `POST /machines` — create (201). Requires write role.
- `PATCH /machines/:id` — update. Requires write role.
- `DELETE /machines/:id` — soft delete (204). Requires write role.

## Services / Key Functions
- `listMachines(input, user)` → `{machines,total,limit,offset}` — company-scoped, ilike search on code/name, optional status filter; `hour_rate` coerced string→number via `toMachine`.
- `getMachine(id, user)` → `Machine`.
- `createMachine(input, user)` → `Machine` — write role; explicit active-duplicate check on code → `ConflictError`; `hour_rate` stored as string (default '0'). **No auto-code** (code is required input).
- `updateMachine(id, input, user)` → `Machine` — name/type/capacity/shifts/status/hourRate.
- `softDeleteMachine(id, user)` → `{ok:true}`.

## Entry Points
Sidebar → **Production → Machine Master** (`/machines`). Read by op-entry (Machine Op Entry `/op-entry/machines`), machine-loading, production-schedule, and so-costing (machine hour-rate × machine time).

## Business Logic
- Manual code entry; uniqueness on `(company_id, code)` among non-deleted rows enforced by explicit check + DB unique index (no `withUniqueRetry` — no auto-numbering to race on).
- `hour_rate` is a numeric column returned as a string by postgres.js and coerced to a number in responses; default 0.
- `status` free-text (default `Idle`) reflects live machine state; `capacity_per_shift` and `shifts_per_day` feed capacity/loading calcs.
- Empty strings normalised to NULL. Soft delete only.

## Dependencies on Other Modules
- Depends on `companies`/`users` (scoping + audit). Depended on by op-entry, machine-loading, production-schedule, so-costing.

## User Roles / Access
- Read: any authenticated company user. Write: **admin/manager** (`requireWriteRole` + RLS `machines_manager_write`). Access-control matrix key: `machine_create` (dept `production`, label "Machine Master").

## Reports
None directly; machine rate/time feed SO costing and production/loading views.

## Imports / Exports
None.

## Background Jobs
None.
