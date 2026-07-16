# Trash
**Module key:** `trash` · **Domain:** Dashboards, Reporting & System

## Purpose
Admin-only soft-delete recovery centre. Lists soft-deleted rows across a curated set of 17 entity types, and lets an admin restore (clear `deleted_at`), permanently delete a single item, or empty all trash. Mirror of legacy `renderTrash` / `restoreFromTrash` / `permDeleteTrash` / `emptyTrash`. Unlike legacy (which cloned records into a `db.trash` array), trash here is a live `UNION ALL` of soft-deleted rows — every entity already carries its own `deleted_at`.

## Pages / Screens
`apps/web/src/modules/trash/routes/list.tsx` — trash list with per-type counts + restore / perm-delete / empty actions.

## Database Tables
Owns **no tables** — operates on other modules' tables via their `deleted_at`. 17 curated entities (`ENTITIES` / `TABLE_BY_TYPE`): sales_orders, job_work_orders, job_cards, items, clients, vendors, machines, operators, purchase_requests, purchase_orders, goods_receipt_notes, delivery_challans, nc_register, bom_masters (`bom_no` label), route_cards, cost_centers, qc_processes. Human label = each table's `code` (except `bom_masters.bom_no`).

## API Endpoints
`routes.ts` (all require auth; all admin only):
- `GET /trash` — paginated list of soft-deleted rows + `byType` counts → `listTrash`. Query: `type?`, `limit`, `offset`.
- `POST /trash/restore` — clear `deleted_at` for one row → `restoreFromTrash`.
- `POST /trash/perm-delete` — hard-delete one soft-deleted row → `permDeleteTrash`.
- `POST /trash/empty` — hard-delete all soft-deleted rows across all entities → `emptyTrash`.

## Services / Key Functions
- `listTrash(query, user)` → builds a `UNION ALL` over the 17 tables (each selecting id, type, label, deleted_at, deleted_by via join to users), paginated + `byType` histogram. Admin only.
- `restoreFromTrash({type, id}, user)` → `UPDATE ... SET deleted_at = NULL` (bumps updated_by/at), guarded by `company_id` + `deleted_at IS NOT NULL`; emits `RESTORE` activity entry. 404 if not in trash.
- `permDeleteTrash({type, id}, user)` → emits `PERM DELETE` audit **before** the DELETE (so the trail survives), then hard-deletes. Admin only.
- `emptyTrash(user)` → DELETEs all soft-deleted rows per entity, returns `{ deleted: count }`, emits one `PERM DELETE` "Emptied trash" entry.

## Entry Points
Admin → Trash page (System dept).

## Business Logic
- **Trash = live view:** soft-deleted rows surfaced directly from each table's `deleted_at`, not a separate store.
- **Restore** clears `deleted_at` and bumps `updated_by`/`updated_at` (where the table has them).
- **Permanent delete** is the documented admin hard-delete path (CLAUDE.md Rule #8); audit is written first so the record of destruction survives the row.
- All operations require the target row to still be in trash (`deleted_at IS NOT NULL`) and in the caller's company, else 404.

## Dependencies on Other Modules (cross-cutting — restores/purges across the app)
Directly reads/writes the tables owned by sales-orders, job-work-orders, job-cards, items, clients, vendors, machines, operators, purchase-requests, purchase-orders, goods-receipt-notes, delivery-challans, nc-register, bom-master, route-cards, cost-centers, qc-processes. Emits into `activity-log` on every restore/delete. Reads `users` for deleted-by names.

## User Roles / Access
Admin only for all four endpoints (`requireAdminRole`).

## Reports
None (a trash list with per-type counts).

## Imports / Exports
None.

## Background Jobs
None.
