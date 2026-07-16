# QC Dashboard (QC Engineer Dashboard)
**Module key:** `qc-dashboard` · **Domain:** Quality

## Purpose
Read-only QC-engineer management dashboard scoped to a month + optional engineer filter. Shows summary tiles (pending/overdue calls, inspected today, accept rate, month totals), a pending-calls list, per-engineer performance, and top rejection reasons. Narrower than the general `/dashboard/kpis` — intended for QC supervision.

## Pages / Screens
- **QC Dashboard** (`qc-dashboard`) — month + engineer selectors, summary tiles, pending list, engineer-performance table, rejection-reason breakdown.
- Related web-only screen **QC Call Register** (`qc-call-register`, legacy `renderQCDashboard` L4126): a 2-panel accept/reject console that consumes the `qc-history` endpoint and writes via op-entry's `submitQcLog`. Not backed by this module's API.

## Database Tables
None owned. Reads (RLS via base tables): `v_jc_op_status` (pending, `qc_pending>0`), `jc_ops` (`qc_call_date`), `job_cards`, `items`, `sales_order_lines`, `sales_orders`, `op_log` (`log_type='qc'`, today + month slices), `nc_register` (rejection reasons for the month).

## API Endpoints
- `GET /qc-dashboard?month=YYYY-MM&engineer=<name>` — aggregate dashboard. **Role-gated: `admin`/`manager`/`viewer`/`qc` only** (others get 403).

## Services / Key Functions
- `getQcDashboard(user, query)` → `QcDashboardResponse` — `requireQcVisibility` (role gate) + 5 parallel reads: summary counters (CTE over pending / today_logs / month_logs), pending list (≤200, oldest `qc_call_date` first), engineer performance (grouped by operator_name), top rejection reasons (≤8 from nc_register), engineer dropdown options. Read-only; no transactions.
- Helpers: month window math (`monthStartIso`, `monthEndExclusiveIso`), `pctOrNull`.

## Entry Points
Web route `qc-dashboard`. API `GET /qc-dashboard`.

## Business Logic
- **Pending calls** = ops from `v_jc_op_status` with `qc_pending > 0`. **Overdue** = pending with `qc_call_date` not null AND `CURRENT_DATE - qc_call_date > 1` (older than 1 day). Backlog counts are independent of the engineer filter.
- **Today / month aggregates** — from `op_log` where `log_type='qc'` on `log_date = today` / in the month window. Engineer filter narrows the op_log slice but NOT the pending/overdue backlog.
- **Accept rate** = accepted / (accepted + rejected), null when denominator 0 (`todayRatePct`, `monthRatePct`).
- **Engineer performance** — group month QC logs by `operator_name` (null → `(unknown)`): calls, accepted/rejected qty, rate %, avg response days = `AVG(log_date - qc_call_date)` where call date present.
- **Top rejection reasons** — nc_register grouped by `reason_category` for the month (engineer filter deliberately NOT applied — NCs aren't keyed to the inspector). Each with count + % of total.
- **wait_days** on pending rows = `CURRENT_DATE - qc_call_date` (null if no call date).

## Dependencies on Other Modules
- **jc-ops / op-entry** — QC ops + `qc_call_date` + QC op_log entries. Reads `v_jc_op_status`.
- **nc-register** — rejection-reason source.
- **sales-orders / items** — display context. **qc-history** — feeds the sibling QC Call Register screen.

## User Roles / Access (qc role matters here)
Explicit allow-list: `admin`, `manager`, `viewer`, `qc`. Anyone else (operator, procurement, dispatch, design) → 403 `AuthorizationError`. This is a supervisory read view; the `qc` role is a first-class consumer.

## Reports
The whole page is the report (summary tiles, engineer performance, rejection Pareto-style breakdown). No file export in this module.

## Imports / Exports
None.

## Background Jobs
None.
