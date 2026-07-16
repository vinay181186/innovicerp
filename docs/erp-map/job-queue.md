# Job Queue (Machine Queue)
**Module key:** `job-queue` · **Domain:** Production Management & Shop Floor

## Purpose
Per-machine queue of pending operations, manually reorderable by the planner. **NOT** a BullMQ/async job queue — it is the shop-floor "what runs next on this machine" list. Mirrors legacy `renderJobQueue` (HTML L10363) + `applyQueueOrder` + `moveInQueue`. Persists order in `jc_ops.queue_position`.

## Pages / Screens
- Web route `job-queue` (`.../job-queue/routes/list.tsx`). Machine cards, each listing pending ops with move-up / move-down controls; per-machine pending-hours and running/pending counts.

## Database Tables
Owns/writes: **none of its own.** WRITES `jc_ops.queue_position` on reorder (1..N).
Reads: `machines`, `jc_ops`, `job_cards`, `items`, `sales_order_lines`, `sales_orders`, `clients`, `job_work_order_lines`, `job_work_orders`, `running_ops`, `v_jc_op_status`.
`queue_position` (nullable int, migration 0034) on `jc_ops`; NULL sorts last. RLS: `jc_ops_manager_write` gates the reorder write to admin/manager at the DB layer.

## API Endpoints
- `GET /job-queue?machineId=` — pending ops grouped by machine (optionally one machine). Auth required.
- `PUT /job-queue/machines/:machineId/order` — set queue order (`reorderJobQueueInputSchema`: `jcOpIds[]`). Writes `queue_position = 1..N`.

## Services / Key Functions
- `getJobQueue(input, user) → JobQueueResponse` — loads machines; loads non-outsource, non-complete ops with a machine, ordered by `queue_position ASC NULLS LAST, op_seq ASC`; groups by machine; sums `pendingHrs = cycle_time_min × available / 60`; computes running/pending counts. Traces SO (or JW fallback) code + customer for each op.
- `reorderMachineQueue(machineId, input, user) → { ok }` — verifies the machine exists in company, verifies every op id belongs to that machine + company (else ConflictError), then updates each op's `queue_position` to its index+1.

## Entry Points
`server.ts` registers `jobQueueRoutes`.

## Business Logic
- "Pending" op = `computed_status <> 'complete'` AND `op_type <> 'outsource'` AND has a `machine_id`.
- Sort: manual `queue_position` first (NULLs last), then natural `op_seq`.
- Reorder assigns contiguous 1..N positions to the supplied op-id list; all ids must be valid ops on that machine or the whole call fails.
- Per-machine `pendingHrs` rounded to 2 dp; `runningCount` from ops with an active `running_ops` row.

## Dependencies on Other Modules
Shares `jc_ops.queue_position` / scheduling columns with Production Schedule. Uses `v_jc_op_status` engine, `running_ops` (Shop Floor), and SO/JW source tracing.

## User Roles / Access
Read: any authenticated company user. Reorder (PUT): effectively admin/manager via `jc_ops_manager_write` RLS.

## Reports
The queue board. No export.

## Imports / Exports
None.

## Background Jobs
None. Despite the name, there is no BullMQ/Redis async queue here — it is a persisted manual ordering of machine operations.
