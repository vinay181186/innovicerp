# Production Dashboard
**Module key:** `production-dashboard` · **Domain:** Production Management & Shop Floor

## Purpose
Read-only landing dashboard for production. Mirrors legacy `renderDashboard` (HTML L3658). Shows production counters, the list of open job cards, and the "ready to process now" operation list so a planner can see, at a glance, what work is available on the floor.

## Pages / Screens
- Web route `production-dashboard` (`apps/web/src/modules/production-dashboard/routes/index.tsx`). Panels: "⚡ Ready to Process Now", "Open Job Cards", plus counter tiles. Rows link into Op Entry ("Open in Op Entry").

## Database Tables
Owns/writes: **none** — this is a pure read/aggregation dashboard.
Reads:
- `v_jc_op_status` (SQL view; op-level status/available/qty rollup — the SQL mirror of the legacy calcEngine enrichedOps)
- `v_jc_status` (SQL view; JC-level rollup — total_ops/done_ops/computed_status)
- `job_cards`, `jc_ops`, `items`, `machines`
Company isolation is enforced by RLS on the base tables + explicit `company_id = <uuid>` filters in every query.

## API Endpoints
- `GET /production-dashboard` — returns `{ counters, openJobCards, readyToProcess }`. Auth required (any authenticated user); no extra role gate — RLS scopes data.

## Services / Key Functions
- `getProductionDashboard(user) → ProductionDashboardResponse` — three aggregation queries in one `withUserContext` round-trip:
  1. Op-level counters over `v_jc_op_status`: `pendingQty`, `readyOps`, `readyQty`, `outsourceOps`, `atVendor`, `runningOps`.
  2. JC-level counters over `v_jc_status`: `openJc`, `totalJc`, `noOpsJc`.
  3. Open job cards (LIMIT 60) ordered by high-priority first, then due date, then code.
  4. Ready-to-process ops (LIMIT 100): non-outsource ops with `available > 0` OR `computed_status = 'in_progress'`, with `pendingHrs = available * cycle_time_min / 60`.

## Entry Points
`server.ts` registers `productionDashboardRoutes`. Also linked from the work-list service (`dashboard/work-list-service.ts` navPage `/production-dashboard`).

## Business Logic
- "Ready to process" = a non-outsource op that has available qty or is already in progress.
- Counters split outsource vs. in-house: `atVendor` counts outsource ops in status `at_vendor`/`po_created`; `outsourceOps` counts all incomplete outsource ops.
- `pendingQty` sums `GREATEST(available,0)` over non-outsource, non-complete ops.
- `noOpsJc` = open job cards that have no operations defined yet.
- Pending hours per op = `available * cycle_time_min / 60`.

## Dependencies on Other Modules
Reads job-cards / jc-ops / items / machines data and the shared `v_jc_op_status` / `v_jc_status` views (the same status engine used by op-entry, job-queue, stuck-dashboard). Feeds users into Op Entry.

## User Roles / Access
Any authenticated user with a company. No role restriction in the route; multi-tenant isolation via RLS.

## Reports
The dashboard itself is the report (counters + two lists). No export.

## Imports / Exports
None.

## Background Jobs
None. Synchronous read on request.
