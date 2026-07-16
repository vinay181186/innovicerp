# QC Documents (QC Document Matrix & Repository)
**Module key:** `qc-documents` · **Domain:** Quality

## Purpose
Repository + SO-pivoted completion matrix for QC certificates (MIR/MCR/DIR/TPI and others) per Job Card / Sales Order. Registers file metadata (files live in the `qc-docs` Supabase Storage bucket, uploaded direct by the client) and renders a matrix showing, per SO line / JC, which QC op columns are done and whether a document is attached, plus a per-JC line-detail modal with serial-range tracking and mandatory/optional badges. Mirrors legacy `renderQCDocuments` (HTML L23039).

## Pages / Screens
- **QC Docs** (web route `qc-docs`) — SO selector, the completion matrix (dynamic QC columns), and a per-JC line-detail modal (doc-type sections, batches, serial ranges, upload).

## Database Tables
Owns **`qc_documents`** (migration 0039, matrix cols added 0043; `apps/api/src/db/schema.ts` L4433):
- Cols: `id`, `company_id`, `job_card_id` (FK jc, set null), `jc_code_text`, `sales_order_id` (FK, set null), `so_code_text`, `category` (text default `qc-docs`), `doc_type` (notNull), `file_name`, `storage_path`, `uploaded_by_text`; matrix link — `jc_op_id` (FK jc_ops), `qc_op_name`, `sr_from`, `sr_to`; audit cols, `deleted_at`.
- Indexes: `qc_documents_company_jc_idx` `(company_id, job_card_id)`; `qc_documents_company_cat_idx` `(company_id, category)` (both `where deleted_at is null`).
- RLS: `qc_documents_company_read` (select, company); `qc_documents_qc_write` (all, roles `admin`/`manager`/`qc`). Company-isolated.

Reads: `sales_orders`, `sales_order_lines`, `job_cards`, `jc_ops` (`op_type='qc'`), `v_jc_op_status`, `op_log` (`log_type='qc'`), `items`, `report_types` (mandatory config).

## API Endpoints
- `GET /qc-documents` — list docs (filters: category, jobCardId, search across file/doc-type/jc/so). Any authenticated user.
- `GET /qc-documents/so-list` — SO selector list (non-cancelled SOs).
- `GET /qc-documents/matrix?salesOrderId=` — SO-pivoted QC completion matrix.
- `GET /qc-documents/line-detail?jobCardId=` — per-JC modal data (doc-type sections, batches, serial ranges).
- `POST /qc-documents` — register a doc (metadata). Roles: `admin`/`manager`/`qc` via RLS.
- `DELETE /qc-documents/:id` — soft delete.

## Services / Key Functions
- `listQcDocuments(input, user)` → `{ items }`.
- `createQcDocument(input, user)` → `QcDocument` — inserts metadata; `uploaded_by_text` = user email; sets matrix link (`jcOpId`/`qcOpName`/`srFrom`/`srTo`) when from line-detail modal.
- `deleteQcDocument(id, user)` → `{ id }` — soft delete, NotFound if absent.
- `listQcMatrixSos(user)` → `{ sos }` — SO selector.
- `getQcMatrix(salesOrderId, user)` → `QcMatrixResponse` — builds dynamic QC columns + per-JC cells, done/total rollups, doc matching.
- `getQcLineDetail(jobCardId, user)` → `QcLineDetailResponse` — batches with running serial ranges + doc-type sections with mandatory badges.
- `loadMandatoryMap(tx, companyId)` — report_types → mandatory-by-name.

## Entry Points
Web route `qc-docs`. API `/qc-documents` (+ `/so-list`, `/matrix`, `/line-detail`).

## Business Logic
- **QC document matrix columns** — fixed order `MIR, MCR, DIR, TPI` first, then any other QC op names discovered on the SO's JCs, appended in discovery order (fallback `QC` if none). Full names mapped via `QC_DOC_FULL_NAMES` (MIR=Material Inspection Report, MCR=Material Compliance Report, DIR=Dimensional Inspection Report, TPI=Third Party Inspection, plus ICS/ASN/OTH1/OTH2).
- **Cell state** per JC × column: `applicable` (op exists), `done` (`v_jc_op_status.computed_status='complete'`), `pending` (not done & qc_pending>0), accepted qty, `hasDoc` + doc date/path/name.
- **Doc→cell matching** priority: by `jc_op_id`, else `(job_card_id, qc_op_name)`, else `(job_card_id, doc_type)` uppercased (legacy rows predating matrix columns). Newest doc wins per cell.
- **Row overall status**: `no_jc` (SO line with no JC — still emitted), `no_qc` (JC with no QC ops), `complete` (all applicable ops done), else `partial`.
- **Serial-range tracking** (line-detail) — QC batches (op_log qc entries) ordered by date/log_no; serial `srFrom/srTo` computed by running cumulative of accepted qty. Uploaded docs carry their own `sr_from/sr_to`.
- **Mandatory/optional badges** — driven by `report_types.default_mandatory` (Active) when a matching name exists; otherwise the fixed set MIR/MCR/DIR/TPI is treated as mandatory and everything else optional.
- Soft delete only.

## Dependencies on Other Modules
- **job-cards / jc-ops / op-entry** — QC ops + QC op_log batches (source of matrix + serial ranges). Reads `v_jc_op_status`.
- **sales-orders** — matrix pivot dimension. **report-types** — mandatory config. **items** — display.
- **Supabase Storage** (`qc-docs` bucket) — actual files; note SO Documents page surfaces qc_documents read-only via UNION (see `file_registry`).

## User Roles / Access (qc role matters here)
Read: any authenticated user. Write (register/delete): `admin`/`manager`/`qc` per `qc_documents_qc_write` RLS — the `qc` role is a first-class writer here.

## Reports
The completion matrix is itself a QC-coverage report (done/total per SO). No separate export endpoint.

## Imports / Exports
- **Upload** — client uploads file to `qc-docs` Storage bucket, then `POST /qc-documents` registers metadata. **Download/view** — cells and line-detail expose `storage_path`/`file_name` for inline view. No bulk import/export.

## Background Jobs
None.
