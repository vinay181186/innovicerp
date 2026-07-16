# QC Processes (QC Operation Master)
**Module key:** `qc-processes` · **Domain:** Quality

## Purpose
Master data for QC operation/process types (e.g. MIR, DIR, TPI) with a code, description, default cycle time, and active flag. Referenced when building route cards / QC ops and as the vocabulary of QC operations. Standard CRUD master following the Items-master template.

## Pages / Screens
- **QC Processes list** (`qc-processes`) — searchable, paginated table with active filter.
- **New / Edit / Detail** — form (`qc-process-form.tsx`) for create, edit, and detail views.

## Database Tables
Owns **`qc_processes`** (migration referenced in schema; `apps/api/src/db/schema.ts` L460):
- Cols: `id`, `company_id` (FK companies), `code` (text, notNull), `description`, `default_cycle_time_min` numeric(8,2) default 0, `is_active` bool default true, standard audit cols (`created_at/by`, `updated_at/by`, `deleted_at`).
- Indexes: `qc_processes_company_code_uniq` UNIQUE `(company_id, code) where deleted_at is null`; `qc_processes_company_active_idx` `(company_id, is_active) where deleted_at is null`.
- RLS: `qc_processes_company_read` (select, `company_id = current_company_id()`); `qc_processes_manager_write` (all, roles `admin`/`manager`). Company-isolated.

## API Endpoints
- `GET /qc-processes` — list (search on code/description, `isActive` filter, limit/offset). Any authenticated user.
- `GET /qc-processes/:id` — single. Any authenticated user.
- `POST /qc-processes` — create (201). Requires write role (`admin`/`manager`).
- `PATCH /qc-processes/:id` — update. Requires write role.
- `DELETE /qc-processes/:id` — soft delete (204). Requires write role.

## Services / Key Functions
- `listQcProcesses(input, user)` → `{ items, total, limit, offset }` — filtered/paginated, ordered by code.
- `getQcProcess(id, user)` → `QcProcess` — throws NotFound if missing/deleted.
- `createQcProcess(input, user)` → `QcProcess` — `requireWriteRole`; ConflictError on duplicate code (active).
- `updateQcProcess(id, input, user)` → `QcProcess` — `requireWriteRole`; patches description/cycle-time/isActive only.
- `softDeleteQcProcess(id, user)` → `{ ok: true }` — `requireWriteRole`; sets `deleted_at`.
No explicit transactions (single-row writes).

## Entry Points
Web routes `qc-processes` list/new/edit/detail (`apps/web/src/modules/qc-processes/`). API `/qc-processes` CRUD.

## Business Logic
- **Code uniqueness** per company among non-deleted rows (DB unique index + service pre-check → ConflictError).
- `defaultCycleTimeMin` stored as numeric string; defaults to 0.
- Update deliberately does NOT allow changing `code` (immutable business key); only description, default cycle time, active flag.
- `emptyToNull` trims description; empty → null.
- Soft delete only (no hard delete).

## Dependencies on Other Modules
- **companies**, **users** — FK owners/audit. Consumed by route-card / QC-op building elsewhere (QC operation vocabulary). No inbound service calls.

## User Roles / Access (qc role matters here)
Read: any authenticated user. Write (create/update/delete): `admin`/`manager` only via `requireWriteRole` — note the `qc` role does NOT have write access to this master (matches the `qc_processes_manager_write` RLS policy which lists only admin/manager).

## Reports
None (master list only).

## Imports / Exports
None.

## Background Jobs
None.
