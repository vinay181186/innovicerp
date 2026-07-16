# Pending SO Value
**Module key:** `pending-so-value` · **Domain:** Sales & SO Analytics

## Purpose
Read-only financial report: per-SO order value vs dispatched / pending / invoiced /
received / outstanding value, with company-wide totals and a filter
(open / all / overdue / completed). Mirrors legacy `renderPendingSOValue`
(HTML L19272). PL-PSV-1.

## Pages / Screens
web routes under `apps/web/src/modules/pending-so-value/routes/`:
- `list.tsx` — path `pending-so-value` — SO value table + totals row, filter tabs.

## Database Tables
READ-ONLY. Reads via one aggregating raw-SQL query: `sales_orders`, `sales_order_lines` (order value + rate-by-line), `delivery_challan_lines` + `delivery_challans` + `purchase_order_lines` (dispatched value), `invoices` (invoiced + received value). Writes nothing. (`salesOrders` import is `void`-referenced only; the query is raw SQL.)

## API Endpoints
`routes.ts` (auth required):
- `GET /pending-so-value?filter=open|all|overdue|completed` — value rows + totals.

Access: any authenticated company user; RLS via `withUserContext`.

## Services / Key Functions
`service.ts`:
- `getPendingSoValue(filter, user)` → `PendingSoValueResponse` — CTE query (so_order_value / so_dispatched / so_invoiced), applies the filter in TS, maps rows + `sumTotals`.
- `sumTotals(rows)` — private; company-wide value totals + SO count.

## Entry Points
`pendingSoValueRoutes(app)`. Read-only.

## Business Logic
Per-SO value math:
- **orderValue** = Σ `order_qty × rate` over non-deleted lines.
- **dispatchedValue** = Σ `dcl.qty × sol.rate` where the DC line links to the SO line either via `dcl.purchase_order_line_id → pol.source_so_line_id` OR directly via `delivery_challans.sales_order_line_id`. (DC lines carry no rate, so the SO-line rate is used.)
- **pendingValue** = orderValue − dispatchedValue.
- **invoicedValue** = Σ `invoices.grand_total`; **receivedValue** = Σ `invoices.total_paid`; **outstandingValue** = invoiced − received.
- Rows ordered by pending value DESC.

Filter semantics:
- `open` — status `open` OR pending > 0.
- `all` — every SO.
- `overdue` — earliest line due date < today AND pending > 0.
- `completed` — status in {closed, dispatched, cancelled}.

## Dependencies on Other Modules
Reads sales-orders, delivery-challans, purchase-orders, invoices data. No cross-module writes.

## User Roles / Access
Any authenticated company user (read-only). RLS via base tables.

## Reports
This module IS the Pending SO Value report (rows + totals).

## Imports / Exports
None.

## Background Jobs
None.
