# Reports (Canned Reports)
**Module key:** `reports` · **Domain:** Dashboards, Reporting & System

## Purpose
A registry of ~19 hand-written, fixed-shape reports (each a `definition` + `run` pair). Each report runs parameterized SQL scoped to the caller's company and returns columns + rows, with XLSX export. No DSL/codegen — adding a report = drop a file in `definitions/` and register it.

## Pages / Screens
`apps/web/src/modules/reports/routes/`: `list.tsx` (report catalog), `run.tsx` (run + filter + view + export).

## Database Tables
Owns **no tables** — read-only. Reads across sales_orders, sales_order_lines, purchase_orders, job_cards, jc_ops, op_log, nc_register, goods_receipt_notes, items, vendors, design_* tables, and views, per each definition. Company isolation via `withUserContext` (RLS).

## API Endpoints
`routes.ts` (all require auth):
- `GET /reports` — list report definitions -> `listReports`.
- `GET /reports/:slug` — run a report with URL query as filters -> `runReport`.
- `GET /reports/:slug/export.xlsx` — run + stream an XLSX workbook (`lib/excel`).

## Services / Key Functions
- `service.listReports()` -> `{ reports: ReportDefinition[] }` (static, from registry).
- `service.runReport(slug, filters, user)` -> looks up `REPORTS[slug]`, runs inside `withUserContext`, returns `{ slug, title, columns, rows, rowCount, generatedAt, filters }`. Throws `NotFoundError` on unknown slug.
- `registry.ts` — `REPORTS` map + `listReportDefinitions()`. Registered: daily-op-log, nc-summary-by-reason, nc-by-so-jc, nc-register-all, open-po-ageing, items-on-hand, item-tracker, operator-productivity, jc-status-summary, so-open-backlog, vendor-po-summary, stock-movement-log, jc-ageing, grn-qc-log, design-project-summary, design-engineer-workload, design-issue-aging, production-item-tracker, production-so-line-tracker.

## Entry Points
Report catalog page; each report card opens the run view. Export button downloads XLSX.

## Business Logic
- Fixed reports: each `definition` carries slug, title, filter fields; `run({ tx, companyId, filters })` returns `{ columns, rows }`. Per-report filter validation (ISO dates / enums) lives inside each definition.
- Filters arrive as `Record<string,string>` from the query string; empty values dropped (`coerceFilters`).
- XLSX export re-runs the report then builds the workbook with title, columns, rows, filters, generatedBy, generatedAt.

## Dependencies on Other Modules (cross-cutting — observes many)
Pure reader across sales, procurement, production, quality, inventory, and design data. No writes, no service-to-service calls.

## User Roles / Access
Any authenticated company member; results company-scoped by RLS. No per-report role gating in this slice.

## Reports
The module *is* the report catalog (19 canned reports above), grouped by domain (Sales / Procurement / Production / Quality / Inventory / Design).

## Imports / Exports
Export: XLSX per report via `GET /reports/:slug/export.xlsx`. No import.

## Background Jobs
None.
