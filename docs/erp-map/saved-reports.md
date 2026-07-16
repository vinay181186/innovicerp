# Saved Reports (Ad-hoc Report Builder)
**Module key:** `saved-reports` · **Domain:** Dashboards, Reporting & System

## Purpose
A self-service report builder. Users pick a data source, choose columns, add filters/sort, optionally group with an aggregate, then preview, save, share, run, and export the result as XLSX. Specs are validated against a whitelisted source catalog before any SQL is built (injection-safe). Mirror of the legacy custom-report feature.

## Pages / Screens
`apps/web/src/modules/saved-reports/routes/`: `list.tsx` (my + shared reports), `new.tsx`, `edit.tsx`, `run.tsx`. Components: `builder.tsx` (field picker + filter/sort/group UI), `result-table.tsx`.

## Database Tables
Owns **`saved_reports`** (`schema.ts` ~L2190):
- Cols: `id`, `company_id`, `owner_id` (FK users), `name`, `description default ''`, `source_key text`, `spec jsonb` (the AdHocSpec), `is_shared boolean default false`, standard audit cols, `deleted_at`.
- Indexes: `saved_reports_company_owner_name_uniq` unique on `(company_id, owner_id, name) where deleted_at is null`; `saved_reports_company_shared_idx (company_id, is_shared)`; `saved_reports_owner_idx (owner_id)`.
- RLS: `saved_reports_company_read` (company read) + `saved_reports_company_write` (company write). Service layer adds visibility (own + shared) and owner/admin-only edit.
Reads across sales_order_lines, sales_orders, items, clients, purchase_order_lines, purchase_orders, vendors, job_cards, nc_register, plus views `v_jc_status` / `v_item_stock` (via the 5 registered sources).

## API Endpoints
`routes.ts` (all require auth):
- `GET /saved-reports/sources` — source catalog (field descriptors) -> `listSources`.
- `GET /saved-reports` — my + shared reports -> `listSavedReports`.
- `POST /saved-reports` — create (201) -> `createSavedReport`.
- `GET /saved-reports/:id` — one report -> `getSavedReport`.
- `PUT /saved-reports/:id` — update -> `updateSavedReport`.
- `DELETE /saved-reports/:id` — soft-delete (204) -> `softDeleteSavedReport`.
- `GET /saved-reports/:id/run` — run a saved report -> `runSavedReport`.
- `POST /saved-reports/preview` — run an unsaved spec -> `previewAdHocSpec`.
- `GET /saved-reports/:id/export.xlsx` — run + export saved report.
- `POST /saved-reports/preview/export.xlsx` — run + export a preview spec.

## Services / Key Functions
- `listSources()` -> source descriptors from the catalog.
- `listSavedReports(user)` -> own reports + shared-in-company, owner email joined.
- `getSavedReport(id, user)` -> one report; hidden (404) unless owner, shared, or admin/manager.
- `createSavedReport(input, user)` -> validates `spec.sourceKey === sourceKey`, source exists, name unique per owner; inserts.
- `updateSavedReport(id, input, user)` -> owner-or-manager only; re-validates spec/source; name-uniqueness re-checked.
- `softDeleteSavedReport(id, user)` -> owner-or-manager only; sets `deleted_at`.
- `runSavedReport(id, user)` / `previewAdHocSpec(spec, user)` -> execute via `runAdHoc`.
- `runner.runAdHoc(spec, ctx)` -> the spec->SQL translator (see Business Logic).
- `sources.ts` -> 5 registered sources: `sales-orders`, `purchase-orders`, `job-cards`, `items-stock`, `nc-register`, each a descriptor + `baseSelect` CTE.

## Entry Points
Reports area -> Saved / Custom reports. Builder page for create/edit; run + export from the list or detail.

## Business Logic
- **Whitelist security (`runner.ts`):** column / filter / sort / group keys are checked against the source descriptor before SQL is built. Filter values are bound via Drizzle parameterized `sql` templates (never interpolated); identifiers wrapped via `sql.identifier()`.
- **Op validation:** filter op must match field type — text (equals/notEquals/contains), number (equals/notEquals/gt/lt), date (equals/after/before). Only `filterable` fields filter, only `groupable` fields group.
- **Query shape:** `SELECT <cols> FROM (<baseSelect CTE>) WHERE <preds> ORDER BY <sorts> LIMIT 5000`. Optional grouping -> `SELECT group, COUNT(*), <agg(sumCol)> ... GROUP BY ... LIMIT 200`. Aggregates: COUNT/SUM/AVG/MIN/MAX (non-COUNT requires a numeric sumCol).
- **Company isolation** applied inside each source's `baseSelect` so the runner never sees table layouts.
- **Sharing / ownership:** `is_shared` exposes a report company-wide (read); edits/deletes restricted to owner or admin/manager. Names unique per owner.

## Dependencies on Other Modules (cross-cutting — observes many)
Sources join across sales, procurement, production, inventory, and quality tables (+ views). Reads `users` for owner email. No writes to other modules.

## User Roles / Access
Any authenticated company member can build/run/preview and see own + shared reports. Edit/delete: owner or admin/manager. All company-scoped by RLS.

## Reports
This module *is* the ad-hoc report builder; output is user-defined (5 base sources, arbitrary column/filter/group specs).

## Imports / Exports
Export: XLSX for both saved reports and previews. No import.

## Background Jobs
None.
