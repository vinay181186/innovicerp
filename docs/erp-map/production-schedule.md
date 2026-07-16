# Production Schedule (Gantt)
**Module key:** `production-schedule` · **Domain:** Production Management & Shop Floor

## Purpose
30-day machine-loading Gantt. One row per machine, bars drawn from `jc_ops.planned_start` / `planned_end`, colour-coded by schedule risk. Lets a planner drag/reschedule an op onto a different machine or date. Mirrors legacy `renderProductionSchedule` (HTML L15588) + `_psComputeStats` + `_psBarColor`.

## Pages / Screens
- Web route `production-schedule` (`.../production-schedule/routes/list.tsx`). Gantt grid; each bar tooltips `<jcCode> Op<opSeq> — <operation> (Due <dueDate>)`. Filter tabs (all / active / history / future) and a stats strip.

## Database Tables
Owns/writes: **none of its own tables.** It WRITES to `jc_ops` (updates `machine_id`, `machine_code_text`, `planned_start`, `planned_end`) on reschedule.
Reads: `machines`, `jc_ops`, `job_cards`, `items`, `running_ops`, `v_jc_op_status`.
Scheduling columns `queue_position`, `planned_start`, `planned_end` live on `jc_ops` (added by migration 0034, all nullable). RLS: `jc_ops` has `jc_ops_company_read` (select) and `jc_ops_manager_write` (admin/manager for all writes) — so reschedule requires admin/manager at the DB layer.

## API Endpoints
- `GET /production-schedule?startDate=&filter=` — 30-day Gantt data. `filter` ∈ all|active|history|future (default `all`); `startDate` defaults to today.
- `PATCH /production-schedule/ops/:id` — reschedule one op (`rescheduleJcOpInputSchema`: machineId, plannedStart, optional plannedEnd). RLS gates the write to admin/manager.

## Services / Key Functions
- `getProductionSchedule(input, user) → ProductionScheduleResponse` — loads all machines, then bars for ops with a machine + planned dates overlapping the [startDate, startDate+30] window; buckets each bar by colour; computes `stats` and an `unscheduled` count (ops with a machine but no `planned_start` and not complete).
- `rescheduleJcOp(jcOpId, input, user) → { ok }` — validates plannedEnd ≥ plannedStart, blocks rescheduling a `complete` op (ConflictError), verifies target machine, preserves the original span if plannedEnd omitted, then updates `jc_ops`.

## Entry Points
`server.ts` registers `productionScheduleRoutes`.

## Business Logic
Colour buckets (`colorFor`):
- `done` — op status `complete`.
- `running` — an active `running_ops` row exists for the op.
- `at_risk` — `planned_end > due_date` (will miss).
- `tight` — 0 ≤ (due_date − planned_end) ≤ 2 days buffer.
- `ok` — >2-day buffer, or no due date.
Filter modes: `active` = status in running/available/in_progress/waiting; `history` = complete OR planned_end < today; `future` = planned_start ≥ today AND status not in complete/running.
Stats: total, onSchedule (ok), tight, atRisk, running, unscheduled. Reschedule keeps the original day-span when only a new start is given.

## Dependencies on Other Modules
Writes the same `jc_ops` scheduling columns read by Job Queue. Uses `v_jc_op_status` status engine and `running_ops` (Shop Floor). Links machines and job cards/items.

## User Roles / Access
Read: any authenticated company user. Reschedule (PATCH): effectively admin/manager (enforced by `jc_ops_manager_write` RLS policy).

## Reports
The Gantt + stats strip. No file export.

## Imports / Exports
None.

## Background Jobs
None.
