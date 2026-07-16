# SO Documents
**Module key:** `so-documents` · **Domain:** Sales & SO Analytics

## Purpose
Document management for Sales Orders. An all-SOs overview with per-SO file counts,
and a per-SO detail grouping files by line → category. Backed by the unified
`file_registry` (migration 0055); QC docs are surfaced read-only from their own
table. This is the one `so-*` module that WRITES (registers/soft-deletes files).
Mirrors legacy `renderSODocs` (L19478); ADR-047.

## Pages / Screens
web routes under `apps/web/src/modules/so-documents/routes/`:
- `page.tsx` — path `so-documents` — overview table + per-SO document detail (upload/delete).

## Database Tables
Owned/written: **`file_registry`** (shared unified file table) — this module inserts and soft-deletes rows scoped to a Sales Order. Key cols used: `sales_order_id`, `so_code_text`, `so_line_id`, `so_line_no`, `job_card_id`, `jc_code_text`, `category`, `doc_type`, `file_name`, `storage_path`, `file_size`, `file_type`, `status` (`active`/`archived`), `uploaded_by_text`. Standard `company_id` + audit + `deleted_at`; RLS on the table.

READ-ONLY reads: `sales_orders`, `sales_order_lines` (+`items`), and `qc_documents` (QC docs surfaced read-only via LEFT JOIN through `job_cards.source_so_line_id`; not deletable here).

Files live in the `qc-docs` Supabase Storage bucket — the client uploads bytes direct, then registers metadata here.

## API Endpoints
`routes.ts` (auth required):
- `GET /so-documents/overview` — all-SO file-count table.
- `GET /so-documents/detail?salesOrderId=` — one SO's header + lines + files.
- `POST /so-documents` — register an uploaded file (viewer role rejected).
- `DELETE /so-documents/:id` — soft-delete a `file_registry` row.

## Services / Key Functions
`service.ts`:
- `listSoDocumentOverview(user)` → `SoDocumentOverviewResponse` — per-SO active file count + total size, archived count, read-only QC-doc count.
- `getSoDocumentDetail(salesOrderId, user)` → `SoDocumentDetailResponse` — header, lines, registry files + QC files (merged), totals.
- `createSoDocument(input, user)` → `SoDocumentFile` — inserts a `file_registry` row (`status='active'`, `uploaded_by_text=user.email`).
- `deleteSoDocument(id, user)` → `{ id }` — soft-deletes the registry row.

## Entry Points
`soDocumentsRoutes(app)`. Writes to `file_registry` (shared with sales-orders client-PO attachments and other modules).

## Business Logic
- **Two file sources merged:** `registry` (editable — insert/soft-delete here) and `qc` (read-only, from `qc_documents`; managed in the QC module).
- **QC-doc line linkage:** a QC doc attributes to an SO line via its JC's `source_so_line_id` when available, else surfaced at SO level.
- **Totals (detail):** fileCount = active registry files; totalSize = Σ active file sizes; archivedCount = registry `status='archived'`; qcCount = QC files.
- **Access:** viewers cannot upload (`AuthorizationError`). Delete is registry-only; QC docs cannot be deleted here.
- Soft-delete only (`deleted_at`).

## Dependencies on Other Modules
- **file-registry** (shared table) — also carries sales-orders client-PO / email-ref attachments.
- **qc-documents** — read-only QC file surfacing.
- Reads sales-orders, items data.

## User Roles / Access
- Read: any authenticated company user.
- Upload / delete: any non-viewer role (viewers rejected). RLS enforces company isolation.

## Reports
Overview table doubles as a documents report (file counts/sizes per SO).

## Imports / Exports
File upload/download via Supabase Storage `qc-docs` bucket; metadata registered through this module. No spreadsheet import/export.

## Background Jobs
None.
