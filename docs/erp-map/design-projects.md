# Design Projects
**Module key:** `design-projects` · **Domain:** Dispatch, Finance & Design

## Purpose
The multi-table Design Engineering subsystem: **projects → tasks → issues**, plus **DCR** (Design Change Request) and **DCN** (Design Change Notice). A project optionally links to an SO/client, carries a completion checklist and engineer roster, and rolls up task progress and open-issue counts. Design slice C; mirrors legacy `renderDesignProjects` + `_dpRenderDetail`. Numbering: DP-NNNN / DCR-NNNN / DCN-NNNN.

## Pages / Screens
`apps/web/src/modules/design-projects/routes/`:
- **List** (`list.tsx`) — projects with status filter (active/released/hold), search, task-progress %, open-issue count, and a summary tile row.
- **Detail** (`detail.tsx`) — project header + checklist + engineers; nested tasks, issues, DCRs, DCNs with their create/edit/comment modals.

## Database Tables
Owned/written (`apps/api/src/db/schema.ts`) — all carry `company_id`, audit cols, `deleted_at`, RLS (`*_company_read` + `*_manager_write` admin/manager):

- **`design_projects`**. Cols: `code` (DP-NNNN), `project_name`, `sales_order_id` (FK, set null), `so_code_text`, `client_id` (FK, set null), `client_text`, `lead_text`, `engineers` (jsonb array), `status` (text, default `Design Active`), `start_date`, `target_date`, `description`, `checklist` (jsonb map key→bool), `released_date`, `released_by_text`.
  - Indexes: unique `(company_id, code)`; `(company_id, status)`.
- **`design_tasks`**. Cols: `design_project_id` (FK cascade), `title`, `part_text`, `assignee_text`, `priority` (default `Medium`), `status` (default `Not Started`), `due_date`, `description`, `completed_at`, `discussions` (jsonb array of {author,text,date}).
  - Index: `(design_project_id, status)`.
- **`design_issues`**. Cols: `design_project_id` (FK cascade), `design_task_id` (FK, set null), `title`, `part_text`, `severity` (default `Major`), `status` (default `Open`), `raised_by_text`, `assigned_to_text`, `raised_date`, `resolved_date`, `description`, `discussions` (jsonb).
  - Indexes: `(design_project_id, status)`; `(company_id, status)`. (Also read by the `design-issues` module.)
- **`design_dcrs`**. Cols: `design_project_id` (FK cascade), `code` (DCR-NNNN), `title`, `change_type` (default `Other`), `part_affected`, `priority` (default `Normal`), `status` (default `Submitted`), `requested_by_text`, `request_date`, `description`.
  - Indexes: unique `(company_id, code)`; `(design_project_id, status)`.
- **`design_dcns`**. Cols: `design_project_id` (FK cascade), `linked_dcr_id` (FK, set null), `code` (DCN-NNNN), `title`, `status` (default `Draft`), `description`, `released_date`.
  - Indexes: unique `(company_id, code)`; `(design_project_id, status)`; `(linked_dcr_id)`.

## API Endpoints
`routes.ts` — all require authentication. (No service-level role gate; writes enforced by RLS `manager_write` = admin/manager.)

Projects:
- `GET /design-projects` — list (search/filter/limit/offset) + summary.
- `GET /design-projects/:id` — detail (project + tasks + issues + dcrs + dcns).
- `POST /design-projects` → 201 — create.
- `PATCH /design-projects/:id` — update.
- `POST /design-projects/:id/checklist` — toggle a checklist key.
- `POST /design-projects/:id/release` — mark Released.

Tasks:
- `POST /design-projects/:projectId/tasks` → 201 — create task.
- `PATCH /design-tasks/:id` — update task.
- `POST /design-tasks/:id/comments` → 201 — add discussion comment.

Issues:
- `POST /design-projects/:projectId/issues` → 201 — create issue.
- `PATCH /design-issues/:id` — update issue.
- `POST /design-issues/:id/comments` → 201 — add comment.

DCR / DCN:
- `POST /design-projects/:projectId/dcrs` → 201 / `PATCH /design-dcrs/:id`.
- `POST /design-projects/:projectId/dcns` → 201 / `PATCH /design-dcns/:id`.

## Services / Key Functions
`service.ts` (public, all **transactional** via `withUserContext`):
- Projects: `listDesignProjects(input,user)`, `getDesignProjectDetail(id,user)`, `createDesignProject(input,user)`, `updateDesignProject(id,input,user)`, `toggleDesignChecklistItem(projectId,input,user)`, `releaseDesignProject(id,user)`.
- Tasks: `createDesignTask(projectId,input,user)`, `updateDesignTask(id,input,user)`, `addDesignTaskComment(taskId,input,user)`.
- Issues: `createDesignIssue(projectId,input,user)`, `updateDesignIssue(id,input,user)`, `addDesignIssueComment(issueId,input,user)`.
- DCR/DCN: `createDesignDcr` / `updateDesignDcr` / `createDesignDcn` / `updateDesignDcn`.

Helper `nextSequence(tx, table, prefix, companyId)` allocates DP-/DCR-/DCN- codes via `MAX(regexp suffix)+1`.

## Entry Points
- API `designProjectsRoutes(app)`.
- Web hooks `apps/web/src/modules/design-projects/api.ts`.

## Business Logic
- **Project → tasks → issues:** creating a task or issue verifies the parent project exists in-company; an issue may optionally attach to a task (validated to belong to the same project).
- **Project status:** `Design Active` / `Released` / `On Hold` (list filters map to these). `release` sets `status='Released'`, `released_date=today`, `released_by_text=user`.
- **Checklist:** stored as a jsonb key→bool map; `toggleDesignChecklistItem` flips one key.
- **Task status machine:** editing to `Completed` (from non-completed) stamps `completed_at`; moving away from `Completed` clears it. Progress % = completed/total tasks.
- **Issue status machine:** `Open` / `In Progress` / `Resolved` / `Closed`. Transition into Resolved/Closed stamps `resolved_date`; back to Open/In Progress clears it. Open-issue count = status IN (Open, In Progress).
- **DCR:** created as `Submitted`; status free-updatable via PATCH.
- **DCN:** created as `Draft`; transition to `Released` stamps `released_date`; may link to a DCR (validated in-project).
- **Discussions:** task/issue comments appended to the `discussions` jsonb array as `{author, text, date}`.
- **List summary:** counts of total/active/released/onHold projects, total/done tasks, open issues.

## Dependencies on Other Modules
- **Sales Orders** — optional `sales_order_id` link + `so_code_text` snapshot.
- **Clients** — optional `client_id` + `client_text` snapshot.
- **Design Issues module** — read-only cross-project list over `design_issues` (writes originate here).
- **Design Work Log module** — its entries link to `design_projects`.

## User Roles / Access
- Read: any authenticated in-company user.
- All writes (project/task/issue/DCR/DCN create + update + comment + release + checklist): no explicit service gate — enforced by RLS `manager_write` → **admin / manager**.

## Reports
- Project list summary tiles (project/task/issue rollups). No file-based reports.

## Imports / Exports
- No file import/export.

## Background Jobs
None.
