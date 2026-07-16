# Production SO List
**Module key:** `prod-so-list` · **Domain:** Sales & SO Analytics

## Purpose
Read-only per-SO production progress list for the shop floor. One aggregated row
per SO with lines count, total order qty, done qty, balance qty, and progress %.
Mirrors legacy `renderProdSOList` (HTML L22954).

## Pages / Screens
web routes under `apps/web/src/modules/prod-so-list/routes/`:
- `list.tsx` — path `prod-so-list` — SO production-progress table (search, paginated).

## Database Tables
READ-ONLY. Reads via raw SQL: `sales_orders` (+`clients`), `sales_order_lines`, `job_cards` (via `source_so_line_id`), `jc_ops`, `v_jc_op_status` view (completed / QC-accepted qty). Writes nothing.

## API Endpoints
`routes.ts` (auth required):
- `GET /prod-so-list?search=&limit=&offset=` — paginated production-progress rows + total.

Access: any authenticated company user; RLS via `withUserContext`.

## Services / Key Functions
`service.ts`:
- `listProdSo(input, user)` → `ListProdSoResponse` — CTE (`line_done`) computes per-line done qty, aggregates per SO, computes progress %; separate count query for pagination total.
- `dateLike` — private date normalizer.

## Entry Points
`prodSoListRoutes(app)`. Read-only.

## Business Logic
- **Per-line done qty** = Σ over linked JCs of the **last op's** qty, where the last op is the max `op_seq` on the JC. The qty taken is `qc_accepted_qty` when the last op `qc_required` or is `op_type='qc'`, otherwise `completed_qty` (from `v_jc_op_status`).
- **Per SO:** linesCount, totalQty = Σ order_qty, doneQty = Σ per-line done, balanceQty = `max(0, total − done)`.
- **Progress %** = `min(100, round(done/total × 100))`.
- **Due date:** SO header has no due date; uses `MIN(line.due_date)` (earliest line due).
- Ordered by SO date DESC, then code DESC.

## Dependencies on Other Modules
Reads sales-orders, job-cards, jc-ops, clients data, and the `v_jc_op_status` view. No cross-module writes.

## User Roles / Access
Any authenticated company user (read-only). RLS via base tables.

## Reports
This module IS the Production SO List report.

## Imports / Exports
None.

## Background Jobs
None.
