# PARITY — Tasks module (Task Board + Daily Task Reports)

> Source of truth: `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html`.
> Read directly (not via summary) 2026-06-03. Two sidebar screens under the
> **Tasks** section: `taskboard` (L14255) + `dailyreports` (L14141).
> Distinct from the existing `daily-report` module = the **production** op-log
> machine report (singular `renderDailyReport`, L10823).

---

## 1. Screens & legacy functions

| Legacy nav | Fn | Our route | Our module |
| ---------- | -- | --------- | ---------- |
| `taskboard` | `renderTaskBoard` L14255 | `/task-board` | `tasks` |
| `dailyreports` | `renderDailyReports` L14141 | `/daily-task-reports` | `daily-task-reports` |

Supporting legacy fns: `_addTask` L14329, `_assignTaskFromContext` L14360,
`_updateTaskStatus` L16535, `_viewTask` L16553, `_nextTaskNo` L14324,
`_markTasksViewed` L14397, `_maybeShowTaskLoginToast` L14418, `wlRule_myTasks`
L3051 (My Work surfacing). Daily reports: `_addDailyReport` L14187,
`_drFormHtml` L14200, `_viewDailyReport` L14225, `_editDailyReport` L14242.

---

## 2. Data model (legacy → our tables)

Legacy stores `db.taskAllocations[]` and `db.dailyReports[]` as Firestore
JSON blobs with **embedded arrays** (`task.comments[]`, `report.tasks[]`).
CLAUDE.md anti-pattern #1 forbids JSON-array columns → each child becomes its
own row. Migration **0051**.

### `tasks` (header) ← `taskAllocations`
| col | type | legacy field | notes |
| --- | ---- | ------------ | ----- |
| id | uuid pk | id | |
| company_id | uuid | — | tenancy |
| code | text | taskNo | `TSK-0001`, per-company sequence |
| title | text not null | title | |
| description | text | description | |
| assigned_to | uuid→users | assignedTo | |
| assigned_by | uuid→users | assignedBy | |
| priority | `task_priority` enum | priority | high/medium/low (legacy High/Medium/Low) |
| due_date | date not null | dueDate | |
| status | `task_status` enum | status | todo/in_progress/completed/cancelled |
| started_date | date | startedDate | set when → in_progress |
| completed_date | date | completedDate | set when → completed |
| linked_ref_type | text | linkedRef.type | PR/PO/SO/NC/CAPA/JC/GRN/DESIGN |
| linked_ref_id | text | linkedRef.id | source record id (legacy uid; stored as text) |
| linked_ref_display | text | linkedRef.display | e.g. `PR-00214` |
| linked_ref_nav_page | text | linkedRef.navPage | legacy nav page key |
| viewed_at | timestamptz | viewedAt | null = unread by assignee |
| + standard audit cols | | createdDate→created_at | |

**Overdue is derived, never stored**: `status != completed && due_date < today`.

### `task_comments` (rows) ← `task.comments[]`
| col | type | legacy | |
| --- | ---- | ------ | - |
| id | uuid pk | | |
| company_id | uuid | | |
| task_id | uuid→tasks cascade | | |
| comment_date | date | c.date | |
| text | text not null | c.text | |
| created_by | uuid→users | c.by (name) | display "by" = created_by user's name |
| + audit | | | |

### `daily_reports` (header) ← `dailyReports`
| col | type | legacy | |
| --- | ---- | ------ | - |
| id | uuid pk | id | |
| company_id | uuid | | |
| user_id | uuid→users | userId | report owner |
| report_date | date not null | date | |
| shift | `shift` enum | shift | reuse existing day/night/general |
| + audit | | createdDate→created_at | |

### `daily_report_lines` (rows) ← `report.tasks[]`
| col | type | legacy | |
| --- | ---- | ------ | - |
| id | uuid pk | | |
| company_id | uuid | | |
| daily_report_id | uuid→daily_reports cascade | | |
| line_no | int | (index+1) | |
| description | text not null | t.desc | |
| ref | text | t.ref | free-text SO/JC ref |
| hours | numeric(6,2) | t.hours | |
| status | `daily_report_line_status` enum | t.status | completed/in_progress/pending/blocked |
| remarks | text | t.remarks | |
| + audit | | | |

---

## 3. Logic — Task Board

- **List**: all company tasks, filters `assignedTo` / `status` / `priority`,
  sorted by created desc.
- **Status count cards**: To Do / In Progress / Completed / **Overdue**.
  Overdue is computed across ALL tasks (`status != completed && due < today`),
  and an overdue task is counted ONLY in Overdue (not its stored status) —
  legacy L14270-14274. Cards are clickable status filters (Overdue not
  filterable in legacy — clicking it sets `status='Overdue'` which matches no
  stored row; we replicate: Overdue card is a non-filtering display, the other
  three filter).
- **Assign Task** (`_addTask`): admin/manager only (legacy board button is
  `isAdmin()`; context-assign allows admin **or** manager — we unify to
  admin/manager so managers aren't locked out, consistent with our RLS
  manager_write). Fields: assignTo★, title★, description, priority (default
  Medium), dueDate★. code = next `TSK-####`. status=todo. Logs activity CREATE.
- **Contextual assign** (`_assignTaskFromContext`): same create + a `linkedRef`
  {type,id,display,navPage}. Title/description pre-filled from the source
  record. Only active users selectable. We expose this as the same create
  endpoint accepting an optional `linkedRef` — the source-module buttons that
  call it are out of scope for THIS build (added per-screen later); the data
  model + create path support it now.
- **Update status** (`_updateTaskStatus`): admin/manager OR the assignee.
  Status → To Do / In Progress / Completed. Sets started_date on first
  →in_progress, completed_date on first →completed. Optional comment appended
  (by = current user, date = today). Logs activity UPDATE.
- **View task** (`_viewTask`): header facts + description + timeline + comment
  thread. Read-only.
- **Unread tracking**: a task assigned to me with `viewed_at = null` and not
  completed shows a red unread dot. `_markTasksViewed` stamps `viewed_at` when
  the assignee opens their work view. We stamp on **View task** by the assignee
  + expose a `POST /tasks/mark-viewed` the board calls once on mount for the
  current user (mirrors legacy home-render behavior). Login toast
  (`_maybeShowTaskLoginToast`) = a one-per-session count; deferred (no global
  toast bus on web yet — board header shows an unread count badge instead).

## 4. Logic — Daily Task Reports

- **List**: filters user (admin only; non-admin forced to own), dateFrom,
  dateTo; sorted date desc. Columns: Date, User, Shift, #Tasks, Total Hours,
  Actions. Total hours = Σ line.hours.
- **New report** (`_addDailyReport`): date (default today), shift
  (Day/Night/General), ≥1 task line {description, ref, hours, status, remarks}.
  Owner = current user. Logs activity CREATE.
- **Edit** (`_editDailyReport`): owner OR admin. Edit date/shift/lines.
- **View** (`_viewDailyReport`): read-only header + lines.
- Permission: `canEdit = isAdmin || report.userId === me.id`.

---

## 5. Authorization summary

| Action | Who | Enforcement |
| ------ | --- | ----------- |
| read tasks / reports | any company member | RLS company read |
| assign task | admin/manager | service `requireWriteRole` + RLS self-or-manager |
| update task status / comment | assignee OR admin/manager | service check + RLS |
| create/edit own daily report | owner OR admin/manager | service check + RLS self-or-manager |

RLS write policies use `current_user_id()` (migration 0016 helper):
- `tasks`: write if `assigned_to = current_user_id() OR role in (admin,manager)`
  — note assign/reassign is further gated to admin/manager in the service
  (an assignee self-updating keeps assigned_to unchanged so RLS still passes).
- `task_comments`: write if `created_by = current_user_id() OR role in (...)`.
- `daily_reports` / `_lines`: write if owner (`user_id`/`created_by`) OR mgr.

---

## 6. Out of scope for this build (noted, not built)

- Source-module "Assign to user" buttons (PR/PO/SO/NC/CAPA/JC/GRN/DESIGN) — the
  endpoint accepts `linkedRef`; wiring the buttons is a per-screen follow-up.
- My Work / home task surfacing (`wlRule_myTasks`) — the My Work panel is a
  separate cross-cutting feature; tasks feed it once that's built.
- Login toast — needs a global toast bus (not yet on web). Board shows an
  unread badge instead.
- Realtime — legacy silently Firebase-saves viewed stamps; we use normal
  request/response. (ADR-004: Task Allocation is a realtime candidate; deferred
  — polling is fine at current scale.)

No data conflicts requiring a decision were found.
