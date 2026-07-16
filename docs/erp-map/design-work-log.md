# Design Work Log
**Module key:** `design-work-log` · **Domain:** Dispatch, Finance & Design

## Purpose
A daily timesheet feed across the Design team — each entry logs hours an engineer spent on a design project (with an optional task label and a work category). Powers the design team's daily/weekly/per-project effort views. Design slice E; mirrors legacy `renderDesignWorkLog` (`_dpWl*` helpers). Distinct from `design_time_log` (which is per-DSN tracker time under the Design Tracker module).

## Pages / Screens
- **List** (`apps/web/src/modules/design-work-log/routes/list.tsx`) — timesheet feed filtered by engineer, project, and date range; entry create form and delete.

## Database Tables
Owned/written (`apps/api/src/db/schema.ts`) — carries `company_id`, audit cols, `deleted_at`, RLS (`design_work_log_company_read` + `design_work_log_manager_write` admin/manager):

- **`design_work_log`**. Cols: `log_date` (NOT NULL), `engineer_text` (NOT NULL — set from the acting user), `design_project_id` (FK → `design_projects`, set null), `task_text`, `category` (text, default `Design`), `hours` (numeric 6,2, NOT NULL), `description`.
  - Indexes: `(company_id, log_date)`; `(company_id, engineer_text, log_date)`; `(design_project_id)`.

## API Endpoints
`routes.ts` — all require authentication.
- `GET /design-work-log` — list (filters: engineer, fromDate, toDate, designProjectId; limit/offset).
- `POST /design-work-log` → 201 — create an entry.
- `DELETE /design-work-log/:id` → 204 — soft-delete an entry.

## Services / Key Functions
`service.ts` (public, all via `withUserContext`):
- `listDesignWorkLog(input, user)` → `{ items, total, limit, offset }` — raw SQL over `design_work_log` LEFT JOIN `design_projects` (project name + code); applies engineer/date/project filters; separate count query.
- `createDesignWorkLogEntry(input, user)` → entry — verifies the design project exists in-company, then inserts with `engineer_text = user.email ?? user.id`.
- `deleteDesignWorkLogEntry(id, user)` → void — **soft delete** (sets `deleted_at`; no hard delete).

## Entry Points
- API `designWorkLogRoutes(app)`.
- Web hooks `apps/web/src/modules/design-work-log/api.ts`.

## Business Logic
- **Engineer identity** is taken from the authenticated user (email/id), not free-typed — entries are attributable.
- **Project link** is validated on create (NotFoundError if the project is missing/deleted); the FK is `set null` so an entry survives project deletion.
- **Category** defaults to `Design` (work-type classification for the daily/weekly rollups).
- **Delete is soft only** (per project rule 8) — `deleted_at` stamped, list filters exclude deleted rows.
- Filters compose: engineer + date range + project, ordered by `log_date DESC, created_at DESC`.

## Dependencies on Other Modules
- **Design Projects** — every entry references a `design_projects` row (validated on create; project name/code shown in the feed).

## User Roles / Access
- Read: any authenticated in-company user (RLS `company_read`).
- Create / delete: RLS `manager_write` → **admin / manager** (no additional service-level role gate).

## Reports
- Timesheet feed with engineer / project / date filtering; underpins daily, weekly, and per-project effort summaries.

## Imports / Exports
- No file import/export.

## Background Jobs
None.
