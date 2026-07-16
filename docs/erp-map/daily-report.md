# Daily Report (Production Op-Log)
**Module key:** `daily-report` · **Domain:** Production Management & Shop Floor

## Purpose
Per-day production summary of actual work logged on the floor, grouped by machine. Mirrors legacy `renderDailyReport` (HTML L10823). Reads `op_log` for a given date, excludes "start" rows and zero-qty rows, groups by machine and sums quantity. Read-only.

**Distinct from `daily-task-reports`** (which is user-submitted "what I did today" free-text task reports).

## Pages / Screens
- Web route `daily-report` (`.../daily-report/routes/list.tsx`). Date + optional machine filter; machine-grouped tables of op-log rows; a Print action (`lib/print-daily-report.ts`).

## Database Tables
Owns/writes: **none** — pure read/aggregation.
Reads: `op_log`, `jc_ops`, `job_cards`, `items`, `machines`.
`op_log` (schema L870) key cols read: `log_date`, `log_type`, `shift`, `qty`, `operator_name`, `remarks`, `jc_op_id`. Relevant index `op_log_company_op_date_idx (company_id, jc_op_id, log_date)`. RLS company-isolated; query filters `company_id` + `log_date`.

## API Endpoints
- `GET /daily-report?date=&machineId=` — production op-log summary for a date (`dailyReportQuerySchema`; `machineId` optional). Auth required; no role gate.

## Services / Key Functions
- `getDailyReport(input, user) → DailyReportResponse` — one query selecting op-log rows for the date where `log_type <> 'start'` AND `qty > 0` (optionally one machine), joined to op/JC/item/machine, ordered by machine code then op_seq. Groups rows by machine (falling back to `machine_code_text`/'—' when no machine FK), summing `totalQty` per machine and `totalPieces` overall; also counts distinct active machines and JCs.

## Entry Points
`server.ts` registers `dailyReportRoutes`.

## Business Logic
- Only real production output counts: "start" log rows and zero-qty rows are excluded.
- Grouping key = `machine_id`, or a synthetic `__txt:<machineCode>` when the op only has free-text machine.
- Summary rollup: `totalPieces` (sum qty), `logEntries` (row count), `machinesActive` (distinct machine groups), `jcsActive` (distinct JC codes).
- Machine code display = `COALESCE(machine.code, jc_ops.machine_code_text, '—')`.

## Dependencies on Other Modules
Reads Op Log (Op Entry writes it), Job Cards, Items, Machines. No writes.

## User Roles / Access
Any authenticated company user (RLS-scoped).

## Reports
This IS a report screen. Printable via `lib/print-daily-report.ts` (client-side print of the daily production summary). No server-side file export.

## Imports / Exports
Print/export handled client-side (print view). No data import.

## Background Jobs
None.
