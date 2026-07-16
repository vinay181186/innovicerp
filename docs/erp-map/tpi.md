# TPI (Third-Party Inspection)
**Module key:** `tpi` · **Domain:** Quality

## Purpose
Read-only tracker for Third-Party Inspection (TPI) ops — QC operations whose name contains "TPI" that are awaiting an external inspector, plus the record of completed TPI inspections (inspector, organization, certificate no.). Mirrors legacy `renderTPI` (HTML L21381). The TPI submit itself is done through op-entry's `submitQcLog` (with `isTpi` + TPI metadata); this module only surfaces pending + completed.

## Pages / Screens
- **TPI** (`tpi`) — pending TPI ops list (with wait days) + completed TPI records (inspector/organization/cert no./response days/attached report).

## Database Tables
None owned. Reads (RLS via base tables):
- `v_jc_op_status` (pending, `qc_pending>0`), `jc_ops` (`operation` LIKE `%TPI%`, `qc_call_date`), `job_cards`, `items`, `sales_order_lines`, `sales_orders`.
- `op_log` (`is_tpi = true`) — completed TPI records; TPI metadata columns `is_tpi`, `tpi_inspector`, `tpi_organization`, `tpi_cert_no` (added migration 0037), plus `qc_report_path`/`qc_report_name`.

## API Endpoints
- `GET /tpi` — `{ pending, completed }`. Any authenticated user (company-scoped by RLS).

## Services / Key Functions
- `getTpi(user)` → `TpiResponse` — two reads: pending TPI ops (QC ops with `UPPER(operation) LIKE '%TPI%'` AND `qc_pending>0`, wait days from `qc_call_date`/`jc_date`); completed TPI records (op_log where `is_tpi`, last 200, response days = `log_date - qc_call_date`). Read-only.

## Entry Points
Web route `tpi`. API `GET /tpi`. TPI submit reuses op-entry `submitQcLog` (isTpi path).

## Business Logic
- **Pending TPI op** = `v_jc_op_status` where `(qc_required OR op_type='qc')` AND `qc_pending>0` AND operation name contains "TPI" (case-insensitive).
- **Wait days** = `CURRENT_DATE - COALESCE(qc_call_date, jc_date)`, floored at 0.
- **Completed TPI** = `op_log` rows flagged `is_tpi=true`, newest first (≤200): accepted (`qty`) / rejected (`reject_qty`), call date, attended date (`log_date`), response days, and TPI metadata (inspector, organization, certificate no.) + attached QC report.
- No writes/state machine here — inspection results and TPI metadata are captured by op-entry's QC log submit.

## Dependencies on Other Modules
- **op-entry** — TPI inspection is submitted via `submitQcLog` (isTpi + tpi_inspector/organization/cert_no on op_log).
- **jc-ops / job-cards** — TPI QC ops + `qc_call_date`; reads `v_jc_op_status`.
- **sales-orders / items** — display context.

## User Roles / Access (qc role matters here)
Read-only for any authenticated company user; no role gate. TPI submit goes through op-entry (op-entry role governs the write).

## Reports
Pending + completed TPI lists (with response-days SLA) are the report surface. No separate export.

## Imports / Exports
Completed rows expose the attached TPI/QC report (`qc_report_path`/`qc_report_name`) for viewing; file upload happens on the op-entry QC submit. No bulk import/export.

## Background Jobs
None.
