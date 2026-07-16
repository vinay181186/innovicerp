# JWSO Documents
**Module key:** `jwso-documents` · **Domain:** Job Work & Production Execution

## Purpose
Registers uploaded files (PO docs, drawings, etc.) against a JWSO header. JWSOs live in `job_work_orders` (not `sales_orders`), so their documents register in the unified `file_registry` via the `job_work_order_id` dimension (migration 0058). Bytes are pushed by the client directly to the `qc-docs` Supabase Storage bucket; this module only stores/queries metadata. Mirrors the SO-documents module.

## Pages / Screens
No standalone route. Consumed as `api.ts` hooks by the Job Work Orders detail/edit screens (`apps/web/src/modules/jwso-documents/api.ts`; no `routes/` or `components/`).

## Database Tables
Does not own a table — writes to the shared **`file_registry`** table via the `job_work_order_id` dimension. Fields used: `job_work_order_id`, `jw_code_text`, `jw_line_id`, `jw_line_no`, `category` (default `po-docs`), `doc_type`, `file_name`, `storage_path`, `file_size`, `file_type`, `status` (`active`), `uploaded_by_text`, plus `company_id` + audit + soft delete. Company-scoped with RLS via `withUserContext`.

## API Endpoints
`routes.ts`, all authenticated:
- `GET /jwso-documents?jobWorkOrderId=…` — list one JWSO's registered files (most recent first).
- `POST /jwso-documents` — register an already-uploaded file's metadata.
- `DELETE /jwso-documents/:id` — soft-delete a registered file.

## Services / Key Functions
`service.ts` (public):
- `listJwDocuments(jobWorkOrderId, user)` → `{ files }`. First confirms the JWSO exists in this company (404 otherwise, not a silent empty), then selects active `file_registry` rows for that `job_work_order_id`.
- `createJwDocument(input, user)` → the registered file. Rejects `viewer` role; guards the JWSO belongs to the company; inserts a `file_registry` row (`status='active'`, `uploaded_by_text = user.email`).
- `deleteJwDocument(id, user)` → `{ id }`. Soft-delete (sets `deleted_at`); 404 if not found/active.

## Entry Points
Web hooks in `jwso-documents/api.ts`, surfaced inside Job Work Order detail/edit UI.

## Business Logic
- Files are registered after a **direct client upload to Storage** — the API never handles bytes, only metadata.
- **JWSO existence guard** on both list and create (company-scoped) returns 404 rather than empty/allow.
- **Viewers cannot upload** (explicit role check in `createJwDocument`).
- **Soft delete only** (no hard delete), consistent with Rule #8.
- `category` defaults to `po-docs`; documents can carry line-level linkage (`jw_line_id` / `jw_line_no`).

## Dependencies on Other Modules
- `job-work-orders` (parent header existence check).
- Shared `file_registry` table (also used by SO-documents, job-cards QC docs, etc.).
- `db/with-user-context` for RLS.

## User Roles / Access
Read: any authenticated company user. Create: any write-capable role except `viewer` (explicitly blocked). Delete: any authenticated company user within RLS scope.

## Reports
None.

## Imports / Exports
File registration/retrieval only (Supabase Storage `qc-docs` bucket). No spreadsheet import/export.

## Background Jobs
None.
