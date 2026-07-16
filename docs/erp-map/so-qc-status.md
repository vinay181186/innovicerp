# SO QC Status
**Module key:** `so-qc-status` · **Domain:** Sales & SO Analytics

## Purpose
Read-only QC-stage rollup for a Sales Order. Per SO line, aggregates the four QC
sources — in-process QC ops, TPI (third-party inspection), GRN incoming-QC, and
QC documents — into an overall % and status, with per-JC/per-op stage rows and
expandable detail arrays. Mirrors legacy `renderSOQCStatus` (HTML L18347). QC Wave 4.

## Pages / Screens
web routes under `apps/web/src/modules/so-qc-status/routes/`:
- `index.tsx` — path `so-qc-status` — SO selector → per-line QC-stage view.

## Database Tables
READ-ONLY. Reads via raw SQL: `sales_orders`, `sales_order_lines` (+`items`), `job_cards` (via `source_so_line_id`), `jc_ops`, `v_jc_op_status` view (accepted/rejected/pending/completed), `op_log` (QC attempts via `log_type='qc'`; TPI rows via `is_tpi`, with `qc_report_path`/`qc_report_name`), `goods_receipt_note_lines` + `goods_receipt_notes` (GRN incoming QC, attributed to SO line via `pol.source_so_line_id` OR the outsource path `source_jc_op_id → jc_ops → source_so_line_id`), `qc_documents`, `vendors` + `items` (names). Writes nothing.

## API Endpoints
`routes.ts` (auth required):
- `GET /so-qc-status` — SO selector list (excludes `cancelled`).
- `GET /so-qc-status/:soId` — per-line QC rollup + stage/GRN/TPI/doc detail.

Access: any authenticated company user; RLS via base tables.

## Services / Key Functions
`service.ts`:
- `listSoForQc(user)` → `ListSoForQcResponse` — SO selector list.
- `getSoQcStatus(soId, user)` → `SoQcStatusResponse` — per-line QC-ops aggregate + per-JC/op stage rows + TPI + GRN-QC + QC-docs, merged with overall % and status.
- Private helpers: `stageStatus` (passed / passed_rej / in_progress / no_pass per op), `overallPctOf`, `overallOf` (none / pending / in_progress / passed), `toSelector`.

## Entry Points
`soQcStatusRoutes(app)`. Read-only.

## Business Logic
- **Per-op stage** (`stageStatus`): from op input qty vs accepted/rejected + attempt count → `passed`, `passed_rej`, `in_progress`, or `no_pass`. Attempts = count of `op_log` QC entries (drives the [Nx] badge).
- **QC ops per line:** counted from `v_jc_op_status` where `qc_required OR op_type='qc'`; passed = `computed_status='complete'`.
- **GRN-QC "done"** = `qc_status='completed'`. GRN attributes to an SO line via the PO line's `source_so_line_id` OR the outsource path.
- **TPI** rows from `op_log.is_tpi=true`; status `partial` if rejects >0 else `passed`; carries the downloadable report path/name (migration 0043).
- **QC docs** from `qc_documents` on the line's JCs (each counts as uploaded).
- **Overall %** (`overallPctOf`): doneItems/totalItems where items = qcOps + GRN lines + (TPI present?1:0) + docs.
- **Overall status** (`overallOf`): `none` (no QC anywhere), `passed` (ops done AND GRN done), `in_progress` (any progress), else `pending`.
- SO due date surfaced as earliest line due date (SO header has no due date).

## Dependencies on Other Modules
Reads job-cards, jc-ops, op-log, goods-receipt-notes, qc-documents, incoming-qc/tpi data, vendors, items, and the `v_jc_op_status` view. No cross-module writes.

## User Roles / Access
Any authenticated company user (read-only). RLS via base tables.

## Reports
This module IS the SO QC Status report (selector + per-line drill with report-view download links).

## Imports / Exports
QC/TPI report files downloaded via stored `qc_report_path`. No spreadsheet import/export.

## Background Jobs
None.
