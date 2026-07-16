# SO Costing
**Module key:** `so-costing` · **Domain:** Sales & SO Analytics

## Purpose
Read-only cost report per Sales Order. Breaks each SO's cost into three buckets —
Material, Outsource, and Machine-Time — against the SO value, with a per-SO list
and a per-SO line/op drill-down. Mirrors legacy `renderSOCosting` (L17249) +
`_soCostDetail` (L17310).

## Pages / Screens
web routes under `apps/web/src/modules/so-costing/routes/`:
- `list.tsx` — path `so-costing` — SO cost table (value vs material/outsource/machine-time/total).
- `detail.tsx` — path `so-costing/$id` — per-line + per-op cost drill for one SO.

## Database Tables
READ-ONLY. Reads via raw SQL: `sales_orders` (+`clients`, `cost_centers`), `sales_order_lines` (SO value = Σ order_qty×rate), `purchase_order_lines` + `purchase_orders` (material: `po_type <> 'job_work'`, linked via `source_so_line_id`), `jc_ops` + `job_cards` (outsource via `outsource_po_line_id`; machine-time), `v_jc_op_status` view (completed qty), `machines` (`hour_rate`). Writes nothing.

## API Endpoints
`routes.ts` (auth required):
- `GET /so-costing` — all-SO cost rows (ordered by code DESC).
- `GET /so-costing/:id` — per-line/op cost detail with grand totals.

Access: any authenticated company user; RLS via `withUserContext`.

## Services / Key Functions
`service.ts`:
- `listSoCosting(user)` → `ListSoCostingResponse` — one CTE query (material / outsrc / machtime) joined to SO headers; totalCost = material+outsource+machineTime.
- `getSoCostingDetail(soId, user)` → `SoCostingDetail` — header + per-line material cost + per-op (outsource + machine-time) rows grouped by line, with grand totals.

## Entry Points
`soCostingRoutes(app)`. Read-only.

## Business Logic
Cost formulas:
- **Material cost** = Σ `pol.qty × pol.rate` over PO lines linked to the SO line (`source_so_line_id`) where the PO's `po_type <> 'job_work'`.
- **Outsource cost** = Σ `pol.qty × pol.rate` over `jc_ops` with `op_type='outsource'` joined via `outsource_po_line_id`.
- **Machine-time cost** = Σ `(cycle_time_min / 60) × completed_qty × machine.hour_rate` over ops with `op_type NOT IN ('outsource','qc')` and a machine set. `completed_qty` from `v_jc_op_status`.
- **SO value** = Σ `order_qty × rate` over non-deleted SO lines.
- **Cost center:** the SO no longer captures a cost center; falls back to the SO code when `cost_center` is empty (every SO treated as its own cost centre). `cc_name` looked up from `cost_centers` by code.

## Dependencies on Other Modules
Reads purchase-orders, jc-ops/job-cards, machines, clients, cost-centers, and the `v_jc_op_status` view. No cross-module writes.

## User Roles / Access
Any authenticated company user (read-only). RLS via base tables.

## Reports
This module IS the SO Costing report (list + drill).

## Imports / Exports
None.

## Background Jobs
None.
