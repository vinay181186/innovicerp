# Production JW List
**Module key:** `prod-jw-list` · **Domain:** Job Work & Production Execution

## Purpose
Read-only per-JWSO aggregate view for the production floor — one row per Job Work Order showing lines, total qty, done qty, balance and progress %. Mirrors legacy `renderProdJWList`; the JW counterpart of the Prod SO List, computed against `job_work_orders` + `job_work_order_lines` + linked Job Cards.

## Pages / Screens
- `prod-jw-list` — list view (`routes/list.tsx`).

## Database Tables
Owns none. Reads: `job_work_orders`, `job_work_order_lines`, `job_cards`, `jc_ops`, view `v_jc_op_status`, `clients`. Company-scoped + RLS via `withUserContext`.

## API Endpoints
`routes.ts`, authenticated:
- `GET /prod-jw-list` — paginated aggregate list (optional `search` on JW code / customer name).

## Services / Key Functions
`service.ts` (public):
- `listProdJw(input, user)` → `{ items, total, limit, offset }`. Single raw-SQL `WITH line_done` CTE: per JW line, `done_qty` = sum over linked Job Cards of the **last operation's** completed qty — using `qc_accepted_qty` when that final op is QC (`op.qc_required OR op.op_type='qc'`), else `completed_qty` — read from `v_jc_op_status`. Rolls up per header: line count, total order qty, done qty, `balanceQty = max(0, total − done)`, and `progressPct`.

## Entry Points
Web `apps/web/src/modules/prod-jw-list/` (`api.ts`, `routes/list.tsx`). Production navigation.

## Business Logic
- **Done-qty rule:** progress is measured at the **last op** of each linked Job Card (the throughput of the routing's final step), and QC-final ops count accepted qty, not raw completed qty.
- **Linkage:** Job Cards attach via `jc.source_jw_line_id = jwl.id`; deleted JCs/ops/lines excluded.
- **Progress %:** `min(100, round(done/total × 100))`, 0 when total is 0.
- Ordered by `jw_date DESC, code DESC`; `dueDate` is currently NULL in the projection.

## Dependencies on Other Modules
- `job-work-orders` (headers/lines), `job-cards` + `jc-ops` (progress via `v_jc_op_status`), `clients` (name).

## User Roles / Access
Read: any authenticated company user (RLS). No writes.

## Reports
Is itself a production progress report/list. No exports.

## Imports / Exports
None.

## Background Jobs
None.
