# Supply Chain Dashboard
**Module key:** `sc-dashboard` · **Domain:** Production Management & Shop Floor (procurement-facing)

## Purpose
Supply-chain / procurement overview. Aggregates active purchase orders into vendor and SO summaries, a full PO summary (with tax + grand totals), a pending PO-line tracker, and recent GRNs. Mirrors legacy `renderSCDashboard` (L16790). One round-trip, read-only.

## Pages / Screens
- Web route `sc-dashboard` (`.../sc-dashboard/routes/page.tsx`). Sections: summary tiles; "🏢 By Vendor (Open + Partial + QC-Pending)"; "📋 By Sales Order"; "🛒 Complete Purchase Summary (grand total ₹…)"; "🔍 Pending PO Tracker"; "📦 Recent GRN (last 8)".

## Database Tables
Owns/writes: **none** — pure read/aggregation.
Reads: `purchase_orders`, `purchase_order_lines`, `goods_receipt_notes`, `vendors`, `sales_order_lines`, `sales_orders`, `items`.
All queries filter `company_id = <uuid>` and `deleted_at IS NULL`; RLS on base tables enforces isolation. (Queries use `sql.raw` with the interpolated company uuid.)

## API Endpoints
- `GET /sc-dashboard` — returns `{ summary, byVendor, bySo, poSummary, pendingLines, recentGrn }`. Auth required; no extra role gate.

## Services / Key Functions
- `getScDashboard(user) → ScDashboardResponse` — six aggregation queries:
  1. Summary counts by PO status (open/partial/closed/cancelled) + `total_order_val` (qty×rate) and `total_recv_val` (received_qty×rate), excluding cancelled.
  2. GRN totals (all + today).
  3. By-vendor rollup for open/partial/qc_pending POs (lines, unique items, qty, received, total & pending value), top 50 by pending value.
  4. By-SO rollup (lines, unique vendors, values), top 50.
  5. Complete PO summary CTE (`po_agg` + `grn_agg`) with per-PO tax computed in JS: `igst` vs `sgst+cgst`; `grandTotal = totalVal + taxAmount`; LIMIT 100.
  6. Pending PO lines (open/partial/qc_pending) with `pending_qty`/`pending_val`, LIMIT 200; recent GRN LIMIT 8.

## Entry Points
`server.ts` registers `scDashboardRoutes`.

## Business Logic
- "Active" PO = status in open/partial/qc_pending (vendor/SO/pending sections); PO summary includes everything except cancelled.
- `pendingVal = totalOrderVal − totalRecvVal`.
- Tax: `tax_type='igst'` → `totalVal*igst/100`; else `totalVal*(sgst+cgst)/100`.
- Per-line pending = `GREATEST(0, qty − received_qty)`; pending value = pending_qty × rate.
- SO linkage via `purchase_order_lines.source_so_line_id → sales_order_lines → sales_orders`.

## Dependencies on Other Modules
Reads Purchase Orders, GRN, Vendors, Sales Orders modules' tables. Purely presentational rollup — no writes into them.

## User Roles / Access
Any authenticated company user (RLS-scoped). No route-level role restriction.

## Reports
The dashboard sections are the report (vendor/SO/PO/pending/GRN). No file export.

## Imports / Exports
None.

## Background Jobs
None.
