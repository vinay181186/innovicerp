# SO Planning
**Module key:** `so-planning` · **Domain:** Sales & SO Analytics

## Purpose
Read-only backing for the legacy two-pane /planning workflow: a left-pane SO list
with planning %, a right-pane per-SO lines + plans + BOM flags, and a BOM
explosion drill (per line). Writes go through the separate `plans` module. Mirrors
legacy `renderSOPlanning` (HTML L9299) + `showEquipBOMPlanning` (L8848) +
`showBOMPlanning` (L7116). PL-4b.

## Pages / Screens
web routes under `apps/web/src/modules/so-planning/routes/`:
- `workflow.tsx` — path `planning` — two-pane planning workspace (SO list ↔ detail ↔ BOM drill).

## Database Tables
READ-ONLY. Reads: `sales_orders` + `sales_order_lines`, `plans` + `plan_ops`, `job_cards`, `job_work_orders` + `job_work_order_lines`, `bom_masters` + `bom_master_lines`, `items` + `item_stock_balances`, `purchase_requests`. Writes nothing (planning writes live in `plans/service.ts`).

## API Endpoints
`routes.ts` (auth required, read-only):
- `GET /so-planning` — left-pane SO list with planning %.
- `GET /so-planning/:id` — right-pane lines + plans + BOM flags.
- `GET /so-planning/:id/bom/:lineId` — BOM explosion (§8/§9) + child plans for a line.

Access: any authenticated company user; RLS via `withUserContext`.

## Services / Key Functions
`service.ts`:
- `getPlanningSoList(user)` → `PlanningSoListResponse` — open SO headers + per-line totals aggregated in SQL, classified by planning %. 2 round-trips.
- `getPlanningSoDetail(soId, user)` → `PlanningDetailResponse` — lines + plan summaries + BOM flags. 3 round-trips.
- `getPlanningBom(lineId, user)` → `PlanningBomResponse` — BOM explosion + per-child plan/stock status. 5 round-trips.
- `classifyPlanningPct(pct)` — private: `fully_planned` (≥100), `partial` (>0), `unplanned` (0).

## Entry Points
`soPlanningRoutes(app)`. Read-only; complements the `plans` module (which owns writes) and covers both SO-sourced and JWSO-sourced planning.

## Business Logic
- **Planning %** per SO derived from planned qty vs order qty across lines; classified into fully_planned / partial / unplanned.
- **BOM explosion** for equipment/BOM-linked lines: walks `bom_master_lines` (qtyPerSet × set qty), joins stock (`item_stock_balances`) and existing plans/JCs to flag each child's planning state.
- Includes both Sales Orders and Job Work Orders on the list (left pane aggregates both).
- All math mirrors the legacy planning renderers; no state transitions here (read-only).

## Dependencies on Other Modules
- **plans** — owns the write side (this module only reads plans/plan_ops).
- Reads job-cards, job-work-orders, bom-master, items, store (item_stock_balances), purchase-requests data.

## User Roles / Access
Any authenticated company user (read-only). RLS via base tables. Planning writes gated by the `plans` module.

## Reports
Left-pane SO list with planning % is effectively a planning-status report.

## Imports / Exports
None.

## Background Jobs
None.
