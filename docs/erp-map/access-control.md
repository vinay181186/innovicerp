# Access Control
**Module key:** `access-control` · **Domain:** Dashboards, Reporting & System

## Purpose
Admin-managed per-user permission matrix layered on top of the coarse role enum. One row per user carries `full_access`, a `departments` map (drives sidebar section visibility) and a `forms` map of `{ formKey: { view, entry, edit } }`. Single source of truth consumed by the API, web sidebar gating, web button gating, and the matrix editor. Mirror of legacy `db.userAccess`.

## Pages / Screens
`apps/web/src/modules/access-control/routes/list.tsx` (matrix list — one row per user with dept/form counts), `configure-modal.tsx` (edit one user's full matrix).

## Database Tables
Owns **`user_access`** (`schema.ts` ~L4724):
- Cols: `id`, `user_id` (FK users, on delete cascade), `company_id`, `full_access boolean`, `departments jsonb {}`, `forms jsonb {}`, standard audit cols, `deleted_at`.
- Indexes: `user_access_user_uq` unique on `(user_id) where deleted_at is null`; `user_access_company_idx` on `company_id`.
- RLS: `user_access_self_read` (own row), `user_access_admin_read` (admin, same company), `user_access_admin_write` (admin, same company). `company_id` present.

## API Endpoints
`routes.ts` (all require auth):
- `GET /access-control/me` — caller's own `EffectiveAccess` (any role; web shell gates UI) → `getMyAccess`.
- `GET /access-control/users` — admin matrix list with counts → `listUserAccess` (admin only).
- `GET /access-control/users/:userId` — one user's full matrix for the Configure modal → `getUserAccess` (admin only).
- `PUT /access-control/users/:userId` — upsert one user's matrix → `saveUserAccess` (admin only).

## Services / Key Functions
- `getMyAccess(user)` → `EffectiveAccess` — fail-closed (no row = deny all); runs `cascadeFormsMap` on forms before returning.
- `listUserAccess(user)` → all company users left-joined to their access row (users without a row still appear, counts 0). Admin-only.
- `getUserAccess(userId, user)` → full row, or a synthetic empty default if none. Admin-only; verifies target is in caller's company.
- `saveUserAccess(userId, input, user)` → prunes unknown dept/form keys, cascades `view⊆entry⊆edit`, upserts, emits an `ACCESS` activity-log entry. Admin-only.

## Entry Points
Admin → Access Control page (System dept). Every other module's web shell calls `GET /access-control/me` to gate sidebar sections and buttons.

## Business Logic
- **Registry** in `packages/shared/src/enums/access-control.ts`: 9 departments (planning, sales, store, design, production, qc, purchase, finance, system) + 39 form keys (35 legacy + 4 React-only: `tpi_submit`, `qcdocs_upload`, `accesscontrol_manage`, `printtpl_edit`), each mapped to a dept. 3 actions: `view`, `entry`, `edit`.
- **Cascade (edit ⊃ entry ⊃ view):** enforced at save-time by `cascadeFormsMap` — granting `edit` implies `entry` + `view`; `entry` implies `view`. A form counts as "granted" in list summaries if any of view/entry/edit is true.
- **Dept map** gates sidebar sections; **forms map** gates form-level actions.
- Helpers `pruneDeptsMap` / `pruneFormsMap` strip keys not in the registry (defensive against stale client payloads).
- **ADR-035:** in this slice the matrix is UI-only enforcement; per-form gating of other modules' write endpoints is a deferred audit task (RLS + role checks remain the hard floor).

## Dependencies on Other Modules (cross-cutting — gates the whole app)
Read by `dashboard` (dept gating), the web sidebar, and per-button gating everywhere. Writes emit into `activity-log`. Reads the `users` table for company membership.

## User Roles / Access
`getMyAccess` — any authenticated user (self). All list/get/save — admin only (`requireAdminRole`).

## Reports
None.

## Imports / Exports
None.

## Background Jobs
None.
