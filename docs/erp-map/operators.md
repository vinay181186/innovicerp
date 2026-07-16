# Operators (Operator Master)
**Module key:** `operators` · **Domain:** Master Data

## Purpose
Master list of shop-floor workers. Operators are selected when logging Job Card operations / op-entry work and may optionally be linked to a login user account. Codes auto-generate as `OP-###`.

## Pages / Screens
`apps/web/src/modules/operators/routes/`:
- `list.tsx` — `/operators` Operator Master list (search on code/name/department, active filter, paginated).
- `detail.tsx` — read view of a single operator.
- `edit.tsx` — create/edit form (name, department, skills, active, optional linked user).

## Database Tables
- **`operators`** (owned) — `id`, `company_id` (FK), `code`, `name`, `department`, `skills`, `is_active` (default true), `user_id` (nullable FK → users, links to a login account), audit columns, `deleted_at`.
  - Unique: `operators_company_code_uniq` on `(company_id, code)` where not deleted. Indexes: `operators_company_id_idx`, `operators_user_id_idx` (both where not deleted).
  - RLS: `operators_company_read` (same company); `operators_manager_write` (admin/manager AND same company).

## API Endpoints
- `GET /operators` — list (search, isActive).
- `GET /operators/:id` — fetch one.
- `POST /operators` — create (201). Requires write role.
- `PATCH /operators/:id` — update. Requires write role.
- `DELETE /operators/:id` — soft delete (204). Requires write role.

## Services / Key Functions
- `listOperators(input, user)` → `{operators,total,limit,offset}` — company-scoped, ilike search on code/name/department.
- `getOperator(id, user)` → `Operator`.
- `createOperator(input, user)` → `Operator` — write role; auto-generates `OP-###` via `nextOperatorCode` (MAX+1) when no code supplied; `withUniqueRetry` for concurrent collisions; explicit active-duplicate check; `userId` empty → NULL.
- `updateOperator(id, input, user)` → `Operator`.
- `softDeleteOperator(id, user)` → `{ok:true}`.

## Entry Points
Sidebar → **Production → Operator Master** (`/operators`). Read by op-entry / job-cards / jc-ops (operator picker on operation logs), machine op entry, task allocation.

## Business Logic
- Server-authoritative operator code `OP-` + zero-padded MAX+1; manual code accepted.
- Uniqueness on `(company_id, code)` among non-deleted rows; races handled by `withUniqueRetry`.
- `user_id` optionally links the operator to a `users` login account (empty string coerced to NULL).
- Empty strings normalised to NULL. Soft delete only.

## Dependencies on Other Modules
- Depends on `companies`/`users` (scoping, audit, optional `user_id` link). Depended on by op-entry, job-cards, jc-ops, op-log-viewer, shop-floor / machine-loading (operator selection).

## User Roles / Access
- Read: any authenticated company user. Write: **admin/manager** (`requireWriteRole` + RLS `operators_manager_write`). Access-control matrix key: `operator_create` (dept `production`, label "Operator Master").

## Reports
None directly; operator identity flows into op-log / production reports.

## Imports / Exports
None.

## Background Jobs
None.
