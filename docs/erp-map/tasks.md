# Tasks (Task Board)
**Module key:** `tasks` · **Domain:** Catalog & Engineering

## Purpose
Lightweight internal task board. Managers assign tasks to users (optionally linked to a source record like a PR/PO/SO/NC/CAPA/JC/GRN/Design); assignees update status and add comments. Tracks priority, due date, overdue (derived), and unread state per assignee.

## Pages / Screens
Web routes under `apps/web/src/modules/tasks/routes/`:
- `task-board` (board.tsx) — the board: status/priority/assignee filters, status-count tiles, unread badge, create/assign + status-update + comment actions.

## Database Tables
- `tasks` (schema.ts L3969) — `code`, `title`, `description`, `assigned_to` (→users), `assigned_by` (→users), `priority` (taskPriorityEnum, default 'medium'), `due_date`, `status` (taskStatusEnum, default 'todo'), `started_date`, `completed_date`, contextual link (`linked_ref_type` / `linked_ref_id` / `linked_ref_display` / `linked_ref_nav_page`), `viewed_at` (null = unread by assignee). Unique `tasks_company_code_uq`. Indexes on company+assignee, company+status.
- `task_comments` (L4029) — `task_id` (→tasks, cascade), `comment_date`, `text`. Index on task_id.

Both: `company_id`, audit columns, soft delete.

RLS is self-or-manager (not the usual manager-only): `tasks_self_or_manager_write` — a user may write their own task (assigned_to = current user) OR admin/manager may write anything; `task_comments_self_or_manager_write` — comment author or manager. Reads are company-scoped.

## API Endpoints
`routes.ts` (auth required):
- GET `/tasks` — list (query: assignedTo, status, priority) with counts + unreadCount.
- GET `/tasks/user-options` — active users for the assignee picker.
- POST `/tasks/mark-viewed` — stamp viewed_at on the caller's unread tasks.
- GET `/tasks/:id` — task detail with comments.
- POST `/tasks` — create/assign (201). Write role (admin/manager).
- POST `/tasks/:id/status` — update status (+ optional comment).

## Services / Key Functions
`service.ts` (all in `withUserContext` tx):
- `listTasks(filters, user)` → `{tasks, counts, unreadCount}` — loads all company tasks, derives overdue/unread, computes status counts, then applies row filters in memory.
- `getTask(id, user)` → TaskDetail with comments.
- `createTask(input, user)` → TaskDetail — requireWriteRole; validates assignee in company; auto TSK-NNNN code; emits CREATE.
- `updateTaskStatus(id, input, user)` → TaskDetail — assignee OR manager; stamps started/completed dates; optional comment; emits UPDATE.
- `markTasksViewed(user)` → `{updated}` — stamps viewed_at on caller's unread, non-deleted tasks.
- `listUserOptions(user)` → active users (id/name/role).

## Entry Points
Nav → Task Board (`task-board`). Tasks can be assigned from context elsewhere (legacy `_assignTaskFromContext`), populating the linked-ref fields.

## Business Logic
- Code auto-numbered `TSK-NNNN` (max numeric across existing codes + 1).
- **Overdue is derived, never stored**: `status <> 'completed' AND due_date < today` (today computed in IST, UTC+5:30 fixed offset).
- **Unread** = task assigned to the current user, `viewed_at` null, and not completed. `mark-viewed` clears it for the assignee.
- Status counts computed over ALL tasks with overdue taking precedence (an overdue row counts only as overdue, not in its status bucket).
- Status transitions: setting `in_progress` stamps `started_date` (if unset); setting `completed` stamps `completed_date` (if unset).
- Authorization: only admin/manager may create/assign (`requireWriteRole`); status updates allowed by the assignee OR a manager (else AuthorizationError). Enforced in both service and RLS.
- Assignee must belong to the same company (NotFoundError otherwise).
- Soft delete only.
- Audit: CREATE / UPDATE emit `activity_log` entity='Task'.

## Dependencies on Other Modules
- `users` — assignee/assigner names, assignee picker, validation.
- `activity-log` — audit.
- Linked-ref fields point loosely at other modules (PR/PO/SO/NC/CAPA/JC/GRN/Design) for navigation only — no hard FK.

## User Roles / Access
- Read: any authenticated company user (RLS company_read).
- Create/assign: admin/manager (`requireWriteRole`).
- Status update / comment: the assignee or admin/manager (service check + RLS self-or-manager).

## Reports
Status-count tiles (todo / in_progress / completed / overdue) + unread count on the board. No file export.

## Imports / Exports
None.

## Background Jobs
None (overdue + unread derived on read).
