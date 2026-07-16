# Design Tracker
**Module key:** `design-tracker` · **Domain:** Dispatch, Finance & Design

## Purpose
Per-Sales-Order design assignment with a formal review/approval workflow, revision counting, and time logging. One design per SO; its Approved state gates downstream production (BOM Master on Equipment SOs). Design slice B; mirrors legacy `renderDesignTracker`. Numbering: DSN-NNNN.

## Pages / Screens
- **List** (`apps/web/src/modules/design-tracker/routes/list.tsx`) — designs with status/overdue filters, search, per-design total logged hours, and a summary tile row (total, pending, in-progress, review, approved, overdue). Detail (time log, submit/approve/revise actions) is served by the same route/API.

## Database Tables
Owned/written (`apps/api/src/db/schema.ts`) — carry `company_id`, audit cols, `deleted_at`, RLS (`*_company_read` + `*_manager_write` admin/manager):

- **`design_tracker`**. Cols: `code` (DSN-NNNN), `sales_order_id` (FK, set null), `so_code_text`, `item_id` (FK, set null), `item_code_text`, `item_name_text`, `designer` (NOT NULL), `estimated_hours` (numeric 8,2, default 0), `start_date`, `target_date`, `status` (text, default `In Progress`), `revision` (int, default 0), `remarks`, `approved_at`, `approved_by_text`, `review_submitted_at`, `revision_history` (jsonb array of {rev,date,reason,by}).
  - Indexes: unique `(company_id, code)`; `(company_id, sales_order_id)`; `(company_id, status)`.
- **`design_time_log`**. Cols: `design_tracker_id` (FK cascade), `log_date`, `hours` (numeric 6,2, NOT NULL), `worker_text` (NOT NULL), `description`.
  - Index: `(design_tracker_id, log_date)`.

## API Endpoints
`routes.ts` — all require authentication.
- `GET /design-tracker` — list (search/filter/status/limit/offset) + summary.
- `GET /design-tracker/:id` — detail (tracker + time log + total hours).
- `POST /design-tracker` → 201 — create design assignment.
- `PATCH /design-tracker/:id` — update (designer, status, estimated hours, target date, remarks).
- `POST /design-tracker/:id/time` → 201 — log time.
- `POST /design-tracker/:id/submit-review` — submit for review.
- `POST /design-tracker/:id/approve` — approve (**admin/manager only**).
- `POST /design-tracker/:id/revise` — send back for revision (**admin/manager only**).

## Services / Key Functions
`service.ts` (public, all **transactional** via `withUserContext`):
- `listDesignTracker(input,user)` → items + summary (raw SQL joins `design_time_log` for total hours).
- `getDesignTrackerDetail(id,user)` → tracker + time log + total.
- `createDesignTracker(input,user)` — SO must exist; rejects a duplicate active design on the same SO; snapshots the first SO line's item.
- `updateDesignTracker(id,input,user)`.
- `logDesignTime(designTrackerId,input,user)` → time-log entry.
- `submitDesignForReview(id,user)`, `approveDesign(id,user)`, `reviseDesign(id,input,user)`.
- `isDesignApprovedForSo(salesOrderId,user)` → boolean — the production gate (see below).

Helper `nextDesignCode(tx, companyId)` allocates DSN-NNNN.

## Entry Points
- API `designTrackerRoutes(app)`.
- Web hooks `apps/web/src/modules/design-tracker/api.ts`.

## Business Logic
- **Status machine (legacy-verbatim):**
  - `In Progress` → `Review` via `submitDesignForReview` (also from `Revision`); stamps `review_submitted_at`. Rejects if not In Progress/Revision.
  - `Review` → `Approved` via `approveDesign` (admin/manager); stamps `approved_at` + `approved_by_text`. Rejects if not in Review.
  - `Review` → `Revision` via `reviseDesign` (admin/manager); increments `revision`, appends `{rev,date,reason,by}` to `revision_history`. Rejects if not in Review.
  - `Revision` → back to `Review` on resubmit. `updateDesignTracker` can also set status directly (used to move Revision back to In Progress).
- **One-design-per-SO:** create rejects with `ConflictError` if a non-deleted design already targets the SO. Item columns snapshot the SO's first line (item id/code/part name).
- **Time logging:** each `logDesignTime` inserts a `design_time_log` row; detail + list roll up total hours.
- **Overdue:** `target_date < today AND status <> 'Approved'` (list filter + summary).
- **Production gate:** `isDesignApprovedForSo` returns `true` when no design is assigned to the SO (no gate) or the assigned design is `Approved`; used by BOM Master on Equipment SOs to block production until design sign-off.

## Dependencies on Other Modules
- **Sales Orders** — `sales_orders` / `sales_order_lines` (SO existence + first-line item snapshot).
- **BOM Master** — consumes `isDesignApprovedForSo` as an Equipment-SO gate.

## User Roles / Access
- Read + create + update + log time: any authenticated in-company user for read; writes via RLS `manager_write` → **admin / manager**.
- **Approve** and **revise**: explicit service check — **admin** or **manager** only (`AuthorizationError` otherwise).

## Reports
- Design list summary tiles (total / pending / in-progress / review / approved / overdue) with logged-hours rollup. No file-based reports.

## Imports / Exports
- No file import/export.

## Background Jobs
None. Overdue computed on read.
