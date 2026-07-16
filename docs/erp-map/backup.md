# Backup
**Module key:** `backup` · **Domain:** Dashboards, Reporting & System

## Purpose
In-app admin convenience for on-demand database snapshots: per-collection row-count stats and a downloadable JSON dump of masters + recent transactions, scoped to the caller's company. Mirror of legacy `renderBackup`. NOT the real backup discipline — production backup = Supabase auto (daily, 7-day PITR) + daily `pg_dump` → Backblaze B2 per `docs/RUNBOOK.md`. Legacy features (hash-verified backups, restore, factory reset, scheduled auto-backup) are deferred.

## Pages / Screens
`apps/web/src/modules/backup/routes/page.tsx` — collection stats table + Download button.

## Database Tables
Owns **no tables**. Reads across a curated list of 29 tables (companies, users, user_access, items, clients, vendors, machines, operators, cost_centers, osp_processes, qc_processes, bom_masters, route_cards, sales_orders, sales_order_lines, job_work_orders, job_cards, jc_ops, op_log, purchase_requests, purchase_orders, goods_receipt_notes, delivery_challans, nc_register, store_transactions, item_stock_balances, activity_log, alert_config, approval_config, print_templates). Filtered by `company_id` (or `id` for `companies`). Soft-deleted rows included (true snapshot).

## API Endpoints
`routes.ts` (all require auth):
- `GET /backup/stats` — per-collection counts + total → `getBackupStats` (admin only).
- `GET /backup/download` — full JSON dump as an attachment (`InnovicERP_Backup_YYYYMMDD.json`) → `downloadBackup` (admin only).

## Services / Key Functions
- `getBackupStats(user)` → `{ collections[], totalRecords, lastBackupAt: null }`; counts each table via raw SQL, missing tables skipped silently (count 0). Admin only (`requireAdminRole`).
- `downloadBackup(user)` → `{ exportedAt, exportedBy, companyId, collections }` where each collection is up to `MAX_ROWS_PER_TABLE = 5000` rows ordered by `created_at DESC`. Admin only.

## Entry Points
Admin → Backup page (System dept).

## Business Logic
- **Company-scoped snapshot:** `companies` filtered by `id`, all others by `company_id`.
- **Row cap:** 5000 rows per table on download (guards against oversized payloads).
- **Resilience:** a table absent from the dev DB is skipped (try/catch) rather than failing the whole export.
- `lastBackupAt` is always `null` in this slice (no persisted backup-run record).

## Dependencies on Other Modules (cross-cutting — reads the whole DB)
Read-only across the master + transaction tables of virtually every module. No service-to-service calls, no writes.

## User Roles / Access
Admin only for both endpoints.

## Reports
None.

## Imports / Exports
**Export:** JSON dump via `GET /backup/download`. No import/restore in this slice.

## Background Jobs
None in-app. The real scheduled `pg_dump` → Backblaze B2 (daily 02:00 IST, 30-day retention) is an ops process documented in `docs/RUNBOOK.md`, run outside this module.
