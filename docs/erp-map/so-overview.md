# SO Overview
**Module key:** `so-overview` · **Domain:** Sales & SO Analytics

## Purpose
Read-only production dashboard across Sales Orders. One aggregated row per SO
header with stage counters (not-released / in-production / outsourced / QC /
finished / hold), an overall status badge, progress %, and alert flags (at-vendor
qty, QC-pending ops, delayed lines). Provides a per-SO drill-down that walks SO
lines OR BOM children (for equipment SOs). Mirrors legacy `renderSOOverview`
(HTML L9112) + `_deriveSOSummaries` (L9065).

## Pages / Screens
web routes under `apps/web/src/modules/so-overview/routes/`:
- `list.tsx` — path `so-overview` — dashboard list of SO rows with summary tiles and per-row drill-down (lazy-loaded on click).

## Database Tables
READ-ONLY. Reads: `sales_orders` + `sales_order_lines` (headers/lines, filtered by status/search), `job_cards` (via `source_so_line_id`), `jc_ops`, `op_log`, `running_ops`, `items` (item code/name), `machines` + `vendors` (drill-down names), `bom_masters` + `bom_master_lines` (equipment-SO BOM explosion). Writes nothing.

## API Endpoints
`routes.ts` (auth required):
- `GET /so-overview?status=&search=` — dashboard rows + summary. `status` default `open` (or `all`).
- `GET /so-overview/:id/detail` — per-SO drill: child rows (per line or per BOM child) with stage/status/qty breakdown.

Access: any authenticated company user; RLS enforces company isolation.

## Services / Key Functions
`service.ts`:
- `getSoOverview(user, query)` → `SoOverviewResponse` — 6 batched queries (SO headers → lines → JCs → ops/logs/running), then in-memory rollup per SO via the shared calc-engine. Returns rows + summary counts by overall status.
- `getSoOverviewDetail(soId, user)` → `SoOverviewDetailResponse` — drill: equipment SO with a real-uuid `bom_master_id` walks BOM children (qty = qtyPerSet × equipment qty); otherwise one child row per SO line. Adds machine/vendor names + current location (Factory/Vendor/QC).

Uses `lib/calc-engine`: `enrichOps`, `rollupJC`, `rollupSoLine`, `derivePerLineStage`, `deriveOverallSoStatus`. Private `buildChildRow` aggregates completed/QC-pending/at-vendor/in-production qty per row.

## Entry Points
`soOverviewRoutes(app)`. No writes, no cross-module service calls beyond calc-engine.

## Business Logic
- **Per-line stage** (`derivePerLineStage`): not_released, in_production, outsourced, quality_check, finished, hold — decided from the JC rollups for that line.
- **Overall SO status** (`deriveOverallSoStatus`): not_started, in_progress, on_track, delayed, completed, blocked — from done/required qty, hold/finished/delayed counts, earliest due date vs today.
- **Delayed line:** line not finished AND `due_date < today`.
- **Progress %:** `min(100, round(doneQty/requiredQty × 100))`.
- **Alerts:** `atVendorQty` = Σ (inputAvail − completed) over ops with status `outsource_at_vendor`/`outsource_po_created`(/`outsource_pr_raised` in drill); `qcPendingOps` counts ops with status `qc_pending`; `delayedLines` per above.
- **Equipment name:** for `type='equipment'` SOs, taken from the first line's part name; other types render em-dash.
- **Equipment drill:** only when `type='equipment'` AND `bom_master_id` is a real UUID (guards against legacy text values); JCs attributed to BOM children by `job_cards.item_id`.
- `issuedQty` on drill rows is 0 — store_transactions integration deferred (PARITY §3 DELTA).

## Dependencies on Other Modules
- **calc-engine** (`lib/calc-engine`) — all rollup/stage math (shared with so-status, so-planning).
- Reads job-cards, jc-ops, op-log, running-ops, bom-master, items, machines, vendors data.

## User Roles / Access
Any authenticated user in the company (read-only). RLS handles cross-company isolation.

## Reports
This module IS a report/dashboard (SO Overview). Summary tiles: SO count and counts by overall status (not_started / in_progress / on_track / delayed / completed / blocked).

## Imports / Exports
None.

## Background Jobs
None.
