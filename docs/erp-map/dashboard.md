# Dashboard
**Module key:** `dashboard` · **Domain:** Dashboards, Reporting & System

## Purpose
Role-aware home screen. Assembles KPI tiles, a per-role "My Work" action list, data widgets, and a per-user customizable layout (widget order + quick links). Mirror of the legacy `renderHome` / `_homeAdminView` / `_dashWidgets` / `_buildWorkList` code.

## Pages / Screens
Web components in `apps/web/src/modules/dashboard/components/`: `home-admin`, `home-operator`, `home-specialist` (three layouts), `home-widgets`, `home-alerts`, `home-customize`, `my-work-panel`, `dashboard-tiles-grid` / `dashboard-tile`, `kpi-card`, `quick-links`. No `routes/` subfolder — surfaced as the app home.

## Database Tables
Owns **`dashboard_config`** (`apps/api/src/db/schema.ts` ~L4166):
- Cols: `id`, `company_id`, `user_id`, `widgets jsonb (string[])`, `quick_links jsonb (string[])`, standard audit cols, `deleted_at`. `null` widgets/quickLinks = "show all".
- Index: `dashboard_config_company_user_uq` unique on `(company_id, user_id) where deleted_at is null`.
- RLS: `dashboard_config_company_read` (company read); `dashboard_config_self_or_manager_write` (self or admin/manager write). `company_id` present.

All other data is **read-only aggregation** across sales_orders, purchase_orders, jc_ops, nc_register, goods_receipt_note_lines, purchase_requests, running_ops, job_cards, machines, op_log, tasks, capa_records, items, plus views `v_jc_op_status` / `v_jc_status` / `v_item_stock`.

## API Endpoints
`routes.ts` (all require auth; company-scoped):
- `GET /dashboard/kpis` — 7 backlog tiles, role-filtered → `getDashboardKpis`.
- `GET /dashboard/home` — full role-aware home payload → `homeService.getHome`.
- `GET /dashboard/work-list` — My Work list → `workListService.getWorkList`.
- `GET /dashboard/widgets` — computed data widgets → `widgetsService.getWidgets`.
- `GET /dashboard/config` — config screen (config + registries with hasAccess) → `configService.getConfigScreen`.
- `PUT /dashboard/config` — save layout preference → `configService.saveConfig`.

## Services / Key Functions
- `service.getDashboardKpis(user)` → 7 tiles (open SOs/POs, JC ops awaiting QC, NCs pending, GRN lines pending QC, PRs pending PO, ops in progress) with severity, filtered by `TILE_VISIBILITY` per role.
- `home-service.getHome(user)` → resolves layout (operator/specialist/admin), builds KPIs, Today panel, Needs-Attention, quick links, work list.
- `work-list-service.getWorkList / buildWorkListWith` → 9 dept-gated rules (PO approval, PR→PO, incoming QC, BOM pending, my tasks, my CAPAs, overdue JCs, overdue PO, stuck ops), sorted by severity then age.
- `widgets-service.getWidgets(user)` → computes 13 data widgets in registry/config order, gated by dept access.
- `config-service.getConfig / getConfigScreen / saveConfig` → per-user layout upsert.
- `access.loadAccess / hasDept / detectPrimaryDept` → wraps `access-control.getMyAccess` for dept gating.

## Entry Points
App home page after login. Quick-links + widget navPage links deep-link into other modules.

## Business Logic
- **Three layouts:** `operator` (role=operator), `specialist` (single-dept non-admin), `admin` (default / full access).
- **Tile visibility** is an authorization decision local to the service — function roles see only relevant tiles; viewer sees all (read-only audit role).
- **Severity thresholds** per tile: 0=ok, then info/warning/danger by count. Tuned for 15–20 user scale.
- **Work-list resilience:** each rule wrapped in try/catch so one failing rule can't sink the panel (mirrors legacy).
- Dept access resolved via the access-control effective map (`fullAccess` or per-dept flag; admin/manager always true).

## Dependencies on Other Modules
Observes nearly every transactional module (sales, purchase, production, QC, store, tasks, CAPA). Calls `access-control/service.getMyAccess` for gating and `machine-loading/service.getMachineLoading` for the machine-loading widget. Read-only — writes only its own `dashboard_config`.

## User Roles / Access
Any authenticated company member. Content filtered by role + effective dept access. Config write allowed to self or admin/manager.

## Reports
None (KPIs/widgets only; formal reports live in the `reports` module).

## Imports / Exports
None.

## Background Jobs
None.
