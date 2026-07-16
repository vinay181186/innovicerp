# Machine Loading
**Module key:** `machine-loading` · **Domain:** Job Work & Production Execution

## Purpose
Read-only capacity/loading view for the production floor: per-machine capacity cards (pending hours vs weekly capacity, load %, days-to-clear, load status) plus the list of open operations queued across machines. Mirrors legacy `renderLoading` + `calcEngine().machineLoad`. Computed live via raw SQL against `jc_ops ⨝ v_jc_op_status` (no dedicated view/migration).

## Pages / Screens
- `machine-loading` — capacity cards + open-ops list (`routes/list.tsx`).

## Database Tables
Owns none. Reads `machines`, `jc_ops`, view `v_jc_op_status`, `job_cards`, `items`, `sales_order_lines`, `sales_orders`. RLS applied by the base tables under `withUserContext`.

## API Endpoints
`routes.ts`, authenticated:
- `GET /machine-loading` — returns `{ machines, ops }` (no pagination).

## Services / Key Functions
`service.ts` (public):
- `getMachineLoading(user)` → `{ machines, ops }`.
  - **Cards query:** per machine, sums over its non-outsource ops: `totalAvailQty`, `openOps` (available > 0), and `pendingHrs = Σ available × cycle_time_min / 60`. Deleted JCs/ops excluded.
  - **Ops query:** open operations (`available > 0` OR `computed_status='in_progress'`, non-outsource) with JC/item/SO context, priority, due date, completed/available qty, computed status, and per-op `pendingHrs`. Ordered by priority (High first) → due date → op_seq.
- `deriveLoad(pendingHrs, dailyCap)` (private): `weekCap = dailyCap × 5`; `loadPct = pendingHrs / weekCap`; `daysToClear = pendingHrs / dailyCap`; `loadStatus` = Overloaded (>1) | High Load (>0.7) | Manageable (>0 hrs) | Clear.

## Entry Points
Web `apps/web/src/modules/machine-loading/` (`api.ts`, `routes/list.tsx`, plus shared machine-card styling). Production planning navigation.

## Business Logic
- **Daily capacity** = `machines.capacity_per_shift × machines.shifts_per_day`; **weekly** = daily × 5.
- **Pending hours** = available pieces × (op cycle minutes / 60), summed per machine — the same math used on the JC Ops board and `v_jc_op_status`.
- **Load status thresholds:** >100% weekly = Overloaded, >70% = High Load, any pending = Manageable, none = Clear.
- **Scope:** outsource ops excluded from load (they consume vendor capacity, not machine). Open-ops list includes in-progress even when available hits 0.
- **Sort priority:** High-priority JCs first, then earliest due date, then op sequence — the recommended run order per machine.

## Dependencies on Other Modules
- `machines` master (capacity), `jc-ops`/`job-cards` + `v_jc_op_status` (pending work), `items` and `sales-orders` (display context).

## User Roles / Access
Read: any authenticated company user (RLS on base tables). No writes.

## Reports
Is itself the machine-loading/capacity report.

## Imports / Exports
None.

## Background Jobs
None.
