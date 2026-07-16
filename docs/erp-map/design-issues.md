# Design Issues
**Module key:** `design-issues` · **Domain:** Dispatch, Finance & Design

## Purpose
A **read-only, cross-project** view of all Design Issues (bugs/defects raised inside design projects), with search, status/severity filters, per-issue age, and a summary rollup. It is the "All Issues" page that spans projects — issue **writes** (create/update/comment) live in the `design-projects` module, nested under a project. Mirrors legacy `renderDesignIssuesPage`.

## Pages / Screens
- **List** (`apps/web/src/modules/design-issues/routes/list.tsx`) — all issues across projects with filters (open / resolved / critical), search, age-in-days, project name, and a summary tile row.

## Database Tables
Owns **no** tables. Reads `design_issues` (joined to `design_projects` for the project name). The `design_issues` table is defined/owned by the `design-projects` module — see `docs/erp-map/design-projects.md` for its columns, indexes, `company_id`/audit/`deleted_at`, and RLS (`design_issues_company_read` + `design_issues_manager_write`).

Read query surfaces: `severity`, `status`, `raised_by_text`, `assigned_to_text`, `raised_date`, `resolved_date`, `discussions` (jsonb), plus computed `ageDays = GREATEST(0, CURRENT_DATE − raised_date)` and `projectName`.

## API Endpoints
`routes.ts` — requires authentication.
- `GET /design-issues` — cross-project list (search / filter / limit / offset) + summary. Read-only; there are no write routes in this module (writes are `POST /design-projects/:projectId/issues`, `PATCH /design-issues/:id`, `POST /design-issues/:id/comments` in the design-projects module).

## Services / Key Functions
`service.ts`:
- `listDesignIssuesAll(input, user)` → `{ items, total, limit, offset, summary }`. Runs inside `withUserContext` (read-only, no transaction writes). Raw SQL over `design_issues` LEFT JOIN `design_projects`; separate count + summary queries.

## Entry Points
- API `designIssuesRoutes(app)`.
- Web hooks `apps/web/src/modules/design-issues/api.ts`.

## Business Logic
- **Filters:** `open` → status IN (Open, In Progress); `resolved` → status IN (Resolved, Closed); `critical` → severity = Critical AND status NOT IN (Resolved, Closed).
- **Age:** `ageDays` computed from `raised_date` to today.
- **Summary:** counts of total / open / resolved / critical across all non-deleted issues in the company.
- Issue lifecycle (status/severity transitions, `resolved_date` stamping, discussion comments) is implemented in the design-projects service — this module only reads.

## Dependencies on Other Modules
- **Design Projects** — owns the `design_issues` table and all issue writes; provides the project name via join.

## User Roles / Access
- Read: any authenticated in-company user (RLS `design_issues_company_read`). No writes here.

## Reports
- Cross-project issues list with summary tiles (total / open / resolved / critical).

## Imports / Exports
- No file import/export.

## Background Jobs
None.
