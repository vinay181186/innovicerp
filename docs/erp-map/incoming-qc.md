# Incoming QC (Vendor / GRN Inspection)
**Module key:** `incoming-qc` · **Domain:** Quality

## Purpose
Read-only inspection queue for material received against GRNs (Goods Receipt Notes) that is awaiting incoming QC. Surfaces the pipeline of received-but-not-inspected GRN lines, pipeline metrics (value stuck in QC, wait days, oldest GRN), today's accept/reject totals, and the last 20 recently-completed inspections. Mirrors legacy `renderIncomingQC` (HTML L23748). The actual inspect/accept/reject write happens on the GRN detail page (goods-receipt-notes update flow), so this module has no write path.

## Pages / Screens
- **Incoming QC** — single dashboard page at web route `incoming-qc`. Three sections: pipeline metric tiles, pending inspection queue (oldest first), recently-completed list. The "Inspect" action links out to the GRN detail page.

## Database Tables
None owned. Reads (via RLS on base tables):
- `goods_receipt_note_lines` — `received_qty`, `qc_accepted_qty`, `qc_rejected_qty`, `qc_status` (`<> 'completed'` = pending), `qc_date`, `qc_remarks`, `qc_report_path`, `qc_report_name`, `item_id`/`item_code_text`/`item_name`, `purchase_order_line_id`.
- `goods_receipt_notes` — header `code`, `grn_date`, `po_code_text`, `vendor_id`/`vendor_code_text`.
- `purchase_order_lines` — `rate` (used to value pending qty; null for manual GRN lines → treated as 0).
- `vendors`, `items` — display names.

## API Endpoints
- `GET /incoming-qc` — inspection queue + pipeline metrics + recently-completed lines. Access: any authenticated user (company-scoped by RLS); no role gate.

## Services / Key Functions
- `getIncomingQc(user)` → `{ metrics, pending, completed }` — one read: pending lines (received minus accepted minus rejected > 0, qc_status != completed), last-20 completed, today's totals; derives `valueInQc = Σ pendingQty × po_line.rate`, avg/oldest wait days, GRNs-waiting count. No transactions (read-only).
- `dispositionOf(accepted, rejected)` — helper: rejected>0 & accepted>0 → `Partial Accept`; rejected>0 → `Rejected`; else `Accepted`.

## Entry Points
Web route `incoming-qc` (`apps/web/src/modules/incoming-qc/`). API `GET /incoming-qc`.

## Business Logic
- **Pending** = GRN line where `qc_status <> 'completed'` AND `received_qty - qc_accepted_qty - qc_rejected_qty > 0`. Ordered oldest GRN first.
- **Wait days** = `CURRENT_DATE - grn_date` (floored at 0). Oldest pending row drives `oldestDays` / `oldestGrnNo`.
- **Value in QC** = Σ (pendingQty × PO-line rate). Manual GRN lines (no PO line) contribute 0.
- **Disposition** is derived, not stored: computed from accepted vs rejected qty on completed lines.
- **Today's totals** — sum of accepted/rejected qty and distinct GRN count where `qc_status='completed'` AND `qc_date = CURRENT_DATE`.
- No pass/fail state machine here; inspection outcome (accept/reject/qc_report) is written by the GRN module.

## Dependencies on Other Modules
- **goods-receipt-notes** — owns the tables and the inspect/accept write flow this module reads and links to.
- **purchase-orders** — PO line rate for valuation.
- **vendors**, **items** — display names.

## User Roles / Access (qc role matters here)
Read-only for any authenticated company user. `qc` role sees it like everyone else; no special qc gate. Writes are governed by the GRN module's own policies.

## Reports
The pending/completed lists and metric tiles are the report surface. No export endpoint in this module.

## Imports / Exports
None. QC report files (`qc_report_path` / `qc_report_name`) are surfaced as links on completed rows but stored/uploaded via the GRN flow.

## Background Jobs
None.
