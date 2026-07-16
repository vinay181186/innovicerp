# SO Timeline
**Module key:** `so-timeline` · **Domain:** Sales & SO Analytics

## Purpose
Read-only chronological lifecycle view for a single Sales Order. Aggregates events
from across the ERP into one date-sorted, colour-coded (by department) timeline.
Mirrors legacy `_soTimeline(soNo)` (HTML L17679+).

## Pages / Screens
web routes under `apps/web/src/modules/so-timeline/routes/`:
- `index.tsx` — path `so-timeline` — SO picker → vertical event timeline.

## Database Tables
READ-ONLY. Reads: `sales_orders` + `sales_order_lines` (via Drizzle), then raw SQL over `plans`, `job_cards` (+`items`), `purchase_requests`, `purchase_orders` (+`purchase_order_lines`), `goods_receipt_notes`. All keyed off the SO's line IDs (`source_so_line_id` / `so_line_id`). Writes nothing.

## API Endpoints
`routes.ts` (auth required):
- `GET /so-timeline/:soId` — event list for the SO.

Access: any authenticated company user; RLS via base tables.

## Services / Key Functions
`service.ts`:
- `getSoTimeline(soId, user)` → `SoTimelineResponse` — fetches SO + line IDs, then emits events from each source, sorts ascending by date (ties keep source-traversal order). Private `tsLike` normalizes timestamps.

## Entry Points
`soTimelineRoutes(app)`. Read-only.

## Business Logic
Event sources implemented (dept colour in parens):
1. **SO Created** — `sales_orders.so_date` (sales / green).
2. **Plan Created** — `plans` where `so_line_id IN (lines)` (planning / purple).
3. **Job Card Created** — `job_cards.jc_date` via `source_so_line_id` (production / cyan).
4. **JC Completed** — `job_cards.closed_at` when non-null (production).
5. **PR Raised** — `purchase_requests` via `source_so_line_id` (purchase / blue).
6. **PO Created** — `purchase_orders` via `purchase_order_lines.source_so_line_id` (purchase).
7. **GRN Received** — `goods_receipt_notes` where `purchase_order_id IN (POs above)` (store / amber).

Deferred sources (not yet ported): Design Assigned/Approved, BOM Linked, Party Material Received/Returned, JW DC Outward/Inward, Material Issued, Op Started/Completed. Each event carries `{date, kind, icon, label, detail, dept, color}`.

## Dependencies on Other Modules
Reads plans, job-cards, purchase-requests, purchase-orders, goods-receipt-notes, items data. No cross-module service calls.

## User Roles / Access
Any authenticated company user (read-only). RLS via base tables.

## Reports
This module IS the SO Timeline report.

## Imports / Exports
None.

## Background Jobs
None.
