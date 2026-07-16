# Daily Task Reports
**Module key:** `daily-task-reports` · **Domain:** Production Management & Shop Floor

## Purpose
User-submitted "what I did today" reports. Each report is a header (user + date + shift) with one or more task lines (description, ref, hours, status, remarks). Mirrors legacy `renderDailyReports` (HTML L14141) + `_addDailyReport` / `_editDailyReport` / `_viewDailyReport`. Migration 0051.

**Distinct from `daily-report`** (production op-log machine summary). This module is people/task reporting; task lines are stored as their own rows (no JSON-blob anti-pattern).

## Pages / Screens
- Web route `daily-task-reports` (`.../daily-task-reports/routes/list.tsx`). List with user + date-range (from/to) filters; add/edit/view modals (`components/report-modals.tsx`).

## Database Tables
Owns/writes: **`daily_reports`** and **`daily_report_lines`** (full CRUD via service; soft-delete on line replace).
- `daily_reports` (schema L4072): `user_id` (owner FK), `report_date`, `shift` (shift enum, default `day`), audit cols, `deleted_at`. Indexes: `(company_id, user_id)` and `(company_id, report_date)`, both `where deleted_at is null`. RLS: `daily_reports_company_read` + `daily_reports_self_or_manager_write` (own rows OR admin/manager).
- `daily_report_lines` (schema L4115): `daily_report_id` (FK cascade), `line_no`, `description`, `ref`, `hours` numeric(6,2), `status` (daily_report_line_status enum, default `completed`), `remarks`. Unique `(daily_report_id, line_no) where deleted_at is null`. RLS: company read + self-or-manager write (by `created_by`).

## API Endpoints
- `GET /daily-task-reports?userId=&dateFrom=&dateTo=` — list report headers with task count + total hours + `canEdit`.
- `GET /daily-task-reports/:id` — one report with its lines.
- `POST /daily-task-reports` — create (201). Owner is always the current user.
- `PUT /daily-task-reports/:id` — update header + replace lines (owner or admin only).

## Services / Key Functions
- `listDailyReports(filters, user) → { reports, isAdmin, userOptions }` — headers filtered by user/date range; aggregates task count + summed hours per report; `canEdit = admin || owner`.
- `getDailyReport(id, user) → DailyTaskReportDetail` — header + ordered lines + totals.
- `createDailyReport(input, user)` — inserts header (owner = current user) + lines; emits activity log.
- `updateDailyReport(id, input, user)` — owner-or-admin guard (AuthorizationError otherwise); updates header; soft-deletes existing lines and inserts the new set (partial unique index lets new line_no 1..n coexist with soft-deleted rows); emits activity log.
- Helpers: `loadUserNames`, `insertLines`, `getReportInternal`.

## Entry Points
`server.ts` registers `dailyTaskReportsRoutes`.

## Business Logic
- Report ownership is fixed to the creating user (`user.id`); it is not settable from the payload.
- Edit permission: report owner or an admin (`canEditThis = isAdm || r.userId === userId`), enforced both in service and by RLS.
- Line replacement on update is a soft-delete-then-reinsert, keeping history while re-using line numbers 1..N.
- `totalHours` = sum of line `hours`, rounded to 2 dp; `taskCount` = line count.
- Every create/update writes an activity-log entry (entity "Daily Report").

## Dependencies on Other Modules
`activity-log` (emits CREATE/UPDATE events); `users` (owner names + filter options).

## User Roles / Access
Any authenticated company user can create and read. Edit/update restricted to the report owner or admin/manager (service check + `*_self_or_manager_write` RLS). `isAdmin` surfaced to the client to enable cross-user editing/filtering.

## Reports
This module IS the reporting surface (per-user daily task logs with hours). No file export in the API.

## Imports / Exports
None.

## Background Jobs
None. Synchronous CRUD; no BullMQ/async processing.
