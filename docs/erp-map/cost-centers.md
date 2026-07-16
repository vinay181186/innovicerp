# Cost Centers (Cost Center Master)
**Module key:** `cost-centers` · **Domain:** Master Data

## Purpose
Master list of cost centres used to categorise/allocate costs (by department/type). Sales Orders already snapshot the code via `sales_orders.cost_center`; this module maintains the master list (mirror of legacy `renderCostCenters`). Codes are entered manually.

## Pages / Screens
`apps/web/src/modules/cost-centers/routes/`:
- `list.tsx` — `/cost-centers` Cost Center Master list (search on code/name/description, active/department/type filters, paginated).
- `detail.tsx` — read view of a single cost center.
- `new.tsx` — create form.
- `edit.tsx` — edit form (name, department, type, description, active).

## Database Tables
- **`cost_centers`** (owned) — `id`, `company_id` (FK), `code`, `name`, `department`, `type`, `description`, `is_active` (default true), audit columns, `deleted_at`.
  - Unique: `cost_centers_company_code_uniq` on `(company_id, code)` where not deleted. Index `cost_centers_company_active_idx` on `(company_id, is_active)` where not deleted.
  - RLS: `cost_centers_company_read` (same company); `cost_centers_manager_write` (admin/manager AND same company).

## API Endpoints
- `GET /cost-centers` — list (search, isActive, department, type filters).
- `GET /cost-centers/:id` — fetch one.
- `POST /cost-centers` — create (201). Requires write role.
- `PATCH /cost-centers/:id` — update. Requires write role.
- `DELETE /cost-centers/:id` — soft delete (204). Requires write role.

## Services / Key Functions
- `listCostCenters(input, user)` → `{items,total,limit,offset}` — company-scoped, ilike search on code/name/description; optional isActive/department/type filters.
- `getCostCenter(id, user)` → `CostCenter`.
- `createCostCenter(input, user)` → `CostCenter` — write role; explicit active-duplicate check on code → `ConflictError`; code/name trimmed. **No auto-code.**
- `updateCostCenter(id, input, user)` → `CostCenter`.
- `softDeleteCostCenter(id, user)` → `{ok:true}`.

## Entry Points
Sidebar → **Finance → Cost Center Master** (`/cost-centers`). The code is referenced (snapshotted) by `sales_orders.cost_center`; promoting that to a real FK is a future migration.

## Business Logic
- Manual code entry; uniqueness on `(company_id, code)` among non-deleted rows via explicit check + DB unique index.
- `code`/`name` trimmed; other empty strings normalised to NULL.
- `department`/`type` are free-text categorisation used for filtering.
- Soft delete only.

## Dependencies on Other Modules
- Depends on `companies`/`users` (scoping + audit). Loosely depended on by `sales-orders` (stores the cost-center code as a snapshot string, not a FK).

## User Roles / Access
- Read: any authenticated company user. Write: **admin/manager** (`requireWriteRole` + RLS `cost_centers_manager_write`). Access-control matrix key: `cc_create` (dept `finance`, label "Cost Center Master").

## Reports
None directly; cost-center code categorises SOs in costing/financial views.

## Imports / Exports
None.

## Background Jobs
None.
