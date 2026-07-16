# Activity Log
**Module key:** `activity-log` · **Domain:** Dashboards, Reporting & System

## Purpose
Append-only audit trail of significant actions across the ERP. Read-only list with filters, plus low-level emitter functions that other modules call to record CREATE / EDIT / DELETE / OP START / DISPATCH / IMPORT / RESTORE / PERM DELETE / ACCESS / CONFIG / APPROVE / etc. events.

## Pages / Screens
`apps/web/src/modules/activity-log/routes/list.tsx` — filterable audit table (search, action, user, date range).

## Database Tables
Owns **`activity_log`** (`schema.ts` ~L2376):
- Cols: `id`, `company_id`, `ts (default now)`, `user_id` (FK users, on delete set null — legacy "System" rows survive), `user_name text` (snapshot), `action text`, `entity text`, `detail text`, `ref_id text`, `created_at`, `created_by`. **No `updated_at`, no `deleted_at`** — immutable/append-only (ADR-019). `action` is text not enum (legacy emits ad-hoc strings).
- Indexes: `activity_log_company_ts_idx`, `activity_log_company_action_idx`, `activity_log_company_user_idx`.
- RLS: `activity_log_company_read` (company read); `activity_log_manager_insert` (admin/manager insert). No UPDATE/DELETE policies.

## API Endpoints
`routes.ts`:
- `GET /activity-log` — filtered, paginated list → `listActivityLog`. Query: `search`, `action`, `userId`, `fromDate`, `toDate`, `limit`, `offset`.

## Services / Key Functions
- `listActivityLog(query, user)` → `{ entries, total, limit, offset, actions[], users[] }`. Returns distinct actions + distinct {id,name} pairs to drive filter dropdowns without extra endpoints.
- `appendActivityLog(input, user)` → standalone emitter owning its own transaction (use when no caller tx running).
- `emitActivityLog(tx, input, companyId, user)` → low-level emitter writing inside an existing transaction so the audit row is atomic with the caller's mutation (rolls back together). Consumed by items / sales-orders / nc-register / access-control / approval-config / trash / etc.

## Entry Points
Audit Log page (System dept). Emitters invoked from within many other services' write paths.

## Business Logic
- **Append-only:** no update/delete service functions. Rows immutable once written.
- **User snapshot:** `user_name` stored inline so display survives a later hard-delete of the user; `user_id` set null on user delete.
- **Filters** combine into an AND of conditions; `search` is an ILIKE OR across action/entity/detail/userName/refId.
- Ordered `ts DESC, id DESC`.

## Dependencies on Other Modules (cross-cutting — observed by / written from many)
`emitActivityLog` is imported by numerous service modules (access-control, approval-config, trash, items, sales-orders, nc-register, ...). `approval-config` reads this table for its approval history (APPROVE/REJECT/PAYMENT actions). Kept dependency-light to avoid circular module imports.

## User Roles / Access
Read: any authenticated company member (RLS company-scoped). Insert: admin/manager at the RLS layer (emitters run within authorized service contexts).

## Reports
None directly (a `daily-op-log` style report lives in the reports module).

## Imports / Exports
None.

## Background Jobs
None.
