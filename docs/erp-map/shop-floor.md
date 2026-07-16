# Shop Floor (Live Running Ops)
**Module key:** `shop-floor` · **Domain:** Production Management & Shop Floor

## Purpose
Live view of operations currently running on the floor, grouped by machine. Mirrors legacy `renderShopFloor` (HTML L10286). Each running op is enriched with its JC, item, source SO/JW, operator, priority, due date, and completion progress. Supports stopping a running op.

## Pages / Screens
- Web route `shop-floor` (`.../shop-floor/routes/list.tsx`). Machine cards, each listing the running ops on that machine with a stop action.

## Database Tables
Owns/writes: **none of its own.** It WRITES to `running_ops` — the stop action updates the row (`status='done'`, `ended_at=now()`).
Reads: `machines`, `running_ops`, `jc_ops`, `job_cards`, `items`, `sales_order_lines`, `sales_orders`, `job_work_order_lines`, `job_work_orders`, `v_jc_op_status`.
`running_ops` (schema L941) key cols: `jc_op_id` (FK, cascade), `machine_id`, `operator_id`/`operator_name`, `start_date`, `start_time`, `shift`, `status` (running_op_status enum, default `running`), `ended_at`, `is_osp`, `company_id`. RLS: company-isolated.

## API Endpoints
- `GET /shop-floor` — returns `{ total, machines[] }`, each machine with its running rows. Auth required.
- `POST /shop-floor/running/:id/stop` — mark a `running_ops` row done.

## Services / Key Functions
- `getShopFloor(user) → ShopFloorResponse` — loads all machines; loads `running_ops` where `status='running'` joined to op/JC/item/SO(or JW fallback)/status view; groups rows by machine; computes `runningCount` per machine and `total`. `doneQty`/`pendingQty` come from `v_jc_op_status.completed_qty` vs `jc.order_qty`. `soCode` = `COALESCE(so.code, jw.code)`.
- `stopRunningOp(runningOpId, user) → { ok }` — verifies the row exists in company; throws ConflictError if not `running`; sets status `done` + `ended_at`.

## Entry Points
`server.ts` registers `shopFloorRoutes`.

## Business Logic
- Source resolution: a JC traces to an SO via `source_so_line_id`, or falls back to a JW via `source_jw_line_id`.
- `pendingQty = GREATEST(0, order_qty − completed_qty)`.
- Rows sorted newest-first by `start_date`, `start_time`.
- Stopping only transitions `running → done`; any other current status is a conflict (idempotency guard).

## Dependencies on Other Modules
`running_ops` rows are created elsewhere (Op Entry "start"); Shop Floor consumes and stops them. Uses the `v_jc_op_status` engine and the SO/JW source-tracing joins shared across production.

## User Roles / Access
Any authenticated company user (RLS-scoped). No explicit role gate on the routes.

## Reports
Live board only. No export.

## Imports / Exports
None.

## Background Jobs
None. Real-time-ish via request/poll (candidate Realtime screen per ARCHITECTURE.md, but implemented as read-on-request here).
