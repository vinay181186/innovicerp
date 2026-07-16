# Print Templates
**Module key:** `print-templates` · **Domain:** Dashboards, Reporting & System

## Purpose
Admin-only editor for the 15 customizable print blocks used on printed documents (PO / OSP DC / JW DC), with full revision history. A template row exists only when an admin has customized that block; otherwise the effective content is the factory default from `PRINT_TEMPLATE_DEFAULTS` (@innovic/shared). Mirror of legacy `_ptSaveContent` / `_loadTemplate` / `_saveTemplateRevision` / `_ptRestoreDefault`.

## Pages / Screens
`apps/web/src/modules/print-templates/routes/`: `editor.tsx` (edit a block's content), `revisions-modal.tsx` (view last 5 revisions).

## Database Tables
Owns two tables (`schema.ts`):
- **`print_templates`** (~L4639) — one active row per `(company, template_key)`; absent = factory default. Cols: `id`, `company_id`, `template_key text`, `content text default ''`, audit cols, `deleted_at`. Unique `print_templates_company_key_uq (company_id, template_key) where deleted_at is null`. RLS: company read; `print_templates_admin_write` (admin only).
- **`print_template_revisions`** (~L4680) — append-only history (service trims display to last 5). Cols: `id`, `company_id`, `template_key`, `content`, `created_at`, `created_by`. Index `print_template_revisions_company_key_created_idx`. RLS: company read; admin insert.

## API Endpoints
`routes.ts` (all require auth):
- `GET /print-templates` — 15 effective templates (customized rows merged with defaults) → `listPrintTemplates`.
- `GET /print-templates/:key/revisions` — last 5 revisions for a key → `listPrintTemplateRevisions`.
- `PUT /print-templates/:key` — save/overwrite a block's content (admin) → `savePrintTemplate`.
- `POST /print-templates/:key/restore-default` — reset a block to factory default (admin) → `restorePrintTemplateDefault`.

## Services / Key Functions
- `listPrintTemplates(user)` → merges customized rows + `PRINT_TEMPLATE_META` defaults into 15 `EffectivePrintTemplate`s with `isCustomised`, `lastEditedBy/At`, `revisionCount`.
- `savePrintTemplate(key, content, user)` → archives previous content to a revision, then updates (or inserts first customization). Admin only.
- `restorePrintTemplateDefault(key, user)` → archives current content to a revision, then **soft-deletes** the row so the factory default applies again. Admin only.
- `listPrintTemplateRevisions(key, user)` → last 5 revisions joined to editor names.
- Re-exports `printTemplateDocType` helper.

## Entry Points
Admin → Print Templates page (System dept, `printtpl_edit` form key). Effective template content is consumed by the print/PDF rendering of PO / OSP DC / JW DC documents.

## Business Logic
- **Default-fallback model:** no row ⇒ factory default; a row ⇒ customized content.
- **Revision on every change:** each save/reset archives the prior content first (no data loss).
- **Reset = soft-delete** (per CLAUDE.md Rule #8) after archiving, cleanly reverting to default. Full history retained; UI shows only the 5 most recent (`REVISIONS_SHOWN`).
- `assertKey` validates the template key against the shared registry (15 keys across doc types).

## Dependencies on Other Modules (cross-cutting — feeds document printing)
Consumed by the print/PDF generation of purchase-orders, OSP delivery challans, and JW delivery challans. Reads `users` for editor names. No writes to other modules.

## User Roles / Access
Read (list + revisions): any authenticated company member. Save + restore-default: admin only (`requireAdminRole`; RLS also admin-only).

## Reports
None.

## Imports / Exports
None (content edited inline; consumed by document print output).

## Background Jobs
None.
