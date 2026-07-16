# Data Integrity Check
**Module key:** `data-integrity` · **Domain:** Dashboards, Reporting & System

## Purpose
Read-only scanner that runs 8 cross-module linkage checks (broken references, orphan rows, stale states, over-age items, non-positive quantities, negative stock) and returns a per-check count + up to 5 sample labels with a severity. Mirror of legacy `runIntegrityCheck` from the Settings page.

## Pages / Screens
No dedicated web `routes/` folder. Surfaced inside the Settings module: `apps/web/src/modules/settings/components/data-integrity-panel.tsx`, rendered by `apps/web/src/modules/settings/routes/index.tsx` (green/red panel per check).

## Database Tables
Owns **no tables** — read-only. Queries job_cards, jc_ops, item_stock_balances, items, purchase_orders, nc_register, purchase_requests, sales_order_lines, sales_orders. Company-scoped via `withUserContext`.

## API Endpoints
`routes.ts`:
- `GET /data-integrity` — run all checks → `runIntegrityCheck` (any authenticated company member).

## Services / Key Functions
- `runIntegrityCheck(user)` → `{ ranAt, results[] }`. Iterates a static `CHECKS` list; each check runs its SQL, collects samples, sets severity (`ok` if 0, `warn` if 1–3, `error` if >3). A check that throws (e.g. table missing in dev) records a `warn` with the error message and the scan continues.

## Entry Points
Settings page → Data Integrity panel.

## Business Logic
The 8 checks (`CHECKS` array):
- **DI-001** Job Cards with no linked SO/JW/legacy ref.
- **DI-002** JC Ops with no machine and not outsource.
- **DI-003** Items with negative on-hand stock.
- **DI-004** POs in Draft > 14 days.
- **DI-005** NC Register rows pending dispose > 7 days.
- **DI-006** PRs Open/Approved with no matching PO and > 7 days old.
- **DI-007** JCs past due date and not complete.
- **DI-008** SO Lines with `order_qty <= 0`.

Each returns up to 5 sample identifiers. Severity: 0 = ok (green), 1–3 = warn, >3 = error (red). Whole scan is resilient — one failing check does not abort the rest.

## Dependencies on Other Modules (cross-cutting — observes many)
Pure reader across production, inventory, procurement, quality, and sales data. No writes, no service-to-service calls. Rendered within the Settings module UI.

## User Roles / Access
Any authenticated company member (results RLS company-scoped). No explicit admin gate in the service, though it is surfaced under admin Settings.

## Reports
The check results themselves are the output; not a formal report export.

## Imports / Exports
None.

## Background Jobs
None (runs on demand when the panel loads).
