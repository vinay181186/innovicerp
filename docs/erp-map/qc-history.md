# QC History
**Module key:** `qc-history` · **Domain:** Quality

## Purpose
Read-only QC tracking log: pending QC ops plus the last 500 completed QC log entries, with tracking stats. Mirrors legacy `renderQCHistory` (HTML L23531). Also serves as the data source for the web-only **QC Call Register** accept/reject console.

## Pages / Screens
- **QC History** (`qc-history`) — pending QC ops list + completed QC log with client-side export (`lib/export.ts`).
- **QC Call Register** (`qc-call-register`, separate web module) — 2-panel pending/completed console that consumes this endpoint and writes via op-entry `submitQcLog`.

## Database Tables
None owned. Reads (RLS via base tables): `v_jc_op_status` (pending, `qc_pending>0`), `jc_ops` (`operation`, `qc_call_date`), `job_cards`, `items`, `sales_order_lines`, `sales_orders`, `op_log` (`log_type='qc'` — completed entries, last 500).

## API Endpoints
- `GET /qc-history` — `{ stats, pending, logs }`. Any authenticated user (company-scoped by RLS).

## Services / Key Functions
- `getQcHistory(user)` → `QcHistoryResponse` — three reads: pending QC ops (with order/completed/accepted/rejected/pending qty, `pendSince` = max complete-log date, overdue flag, `clientPoLineNo`, `qcCallDate`); completed QC log entries (last 500, newest first — accepted/rejected qty, shift, inspector, remarks, log_no, qc report path/name); stats (`totalEntries`, `today`). Read-only.

## Entry Points
Web routes `qc-history` and `qc-call-register`. API `GET /qc-history`.

## Business Logic
- **Pending** = `v_jc_op_status` rows where `(qc_required OR op_type='qc')` AND `qc_pending > 0`, ordered by JC code + op seq.
- **Overdue** = pending op whose `pendSince` (last `complete` op_log date) is before today.
- **Completed logs** = `op_log` where `log_type='qc'`, last 500 by date desc — `qty` is accepted, `reject_qty` is rejected; carries inspector (`operator_name`), shift, remarks, `log_no`, and attached QC report path/name.
- **Stats** — pendingOps (count of pending), overdue count, total QC entries, entries logged today (`log_date = CURRENT_DATE`).
- No writes here — the QC accept/reject submit is done through op-entry's `submitQcLog`.

## Dependencies on Other Modules
- **op-entry / jc-ops / job-cards** — QC op_log entries + op status (`v_jc_op_status`); QC Call Register reuses `submitQcLog`.
- **sales-orders / items** — display context. **operators** — inspector name options (in QC Call Register).

## User Roles / Access (qc role matters here)
Read-only for any authenticated company user; no role gate. QC writes happen through op-entry (op-entry role).

## Reports
Completed QC log with a client-side export helper (`apps/web/src/modules/qc-history/lib/export.ts`). Tracking stats tiles.

## Imports / Exports
- **Export** — client-side export of the QC log (CSV-style) via `lib/export.ts`. No import.

## Background Jobs
None.
