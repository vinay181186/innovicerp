# PARITY — QC Documents (`renderQCDocuments`)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L23039+ (`renderQCDocuments`), uploads via `_fsUploadAndRegister` + `db.fileRegistry` / `db.qcDocUploads`.
> **React target:** **none** — page missing. Route `/qc-docs` (sidebar QC → Report).

---

## Verdict: BUILT ✅ — `/qc-docs` (stood up the app's first file-Storage capability)

Migration `0039` creates a private `qc-docs` Supabase Storage bucket + storage
RLS + a `qc_documents` metadata table. The web client uploads files directly to
Storage (`supabase.storage.from('qc-docs').upload`), then registers metadata via
`POST /qc-documents`; downloads use short-lived signed URLs. Page: upload modal
(file + doc type + category + JC/SO ref) + category/search filters + table
(Doc Type · File · Category · JC · SO · Uploaded By · Date · Open/Delete).

> This is the app's first Storage wiring — the `uploadQcFile`/`signedUrlFor`
> helpers + `qc-docs` bucket can be generalised later for JC drawings / GRN-TPI
> reports / Design files (each currently has a `*_file_path` text col but no
> uploader). Original (pre-build) analysis retained below.

---

### (historical) Original gap analysis

QC Documents is a **file repository**: attach + browse MIR / MCR / Inspection Reports / TPI Reports / Drawings per JC / SO, with category filters, upload, and download. Its core is **binary file upload/download** — legacy uploads to Firebase Storage (`_fsUploadAndRegister`) and registers each file in `db.fileRegistry` (category, docType, fileName, downloadUrl), with a base64 local fallback.

### Infra gap (verified 2026-05-23)
The React app has **no file-upload / Supabase Storage wiring anywhere** — no `storage.from(...).upload(...)`, no signed-URL helper, and **no document/attachment table** in the schema (only `drawing_file_path` text columns on `items`/`job_cards`, with no uploader behind them). So QC Documents cannot be built faithfully without first standing up Storage as a **foundational capability**:

1. **Supabase Storage bucket** (e.g. `qc-docs`) + RLS / signed-URL access policy (Mumbai region per CLAUDE.md).
2. A reusable **upload component** (web) + **signed-URL** issue/verify (api) — shared infra, also reused by JC drawings, GRN/TPI reports, design files.
3. A **`qc_documents`** table: company_id, jc/so ref, category, doc_type, file_name, storage_path, uploaded_by + standard cols + RLS (migration ~`0039`).

### Build plan (dedicated slice — foundational)
1. Storage bucket + api signed-URL endpoints (`POST /files/sign-upload`, `GET /files/sign-download`) + web `useFileUpload` hook. **This is the long pole** — it's app-wide file infra, not QC-specific.
2. `qc_documents` table + `modules/qc-documents` CRUD (list by JC/SO, register on upload).
3. Web `/qc-docs`: category filter + per-doc cards/table (type, name, JC/SO, download) + upload (drag/drop or picker).
4. Sidebar QC → Report "QC Documents" + router. Backfill the QC-doc attach points already stubbed in the JC modal / Incoming-QC / TPI / QC-Call-Register submit forms.

### Interim option (no Storage)
A **QC-document register** (metadata only — track which doc types are required/received per JC/SO, no binary) is buildable now with just the `qc_documents` table. Lower value (the point is the files), so deferred in favour of doing the Storage capability properly.

> Recommend a focused session to build the **file-Storage capability** first (it unblocks QC Documents + JC drawings + GRN/TPI report attachments + Design files across the app), then this page is a thin layer on top.
