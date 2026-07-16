# Report Types (Report / Document Master)
**Module key:** `report-types` · **Domain:** Master Data

## Purpose
Master list of QC/inspection report (document) types — e.g. MIR, MCR, inspection, TPI — each with a default "mandatory" flag and Active/Inactive status. Mirror of legacy `renderReportMaster`. Used by the QC documents workflow to define which report types exist and which are required by default.

## Pages / Screens
`apps/web/src/modules/report-types/routes/`:
- `list.tsx` — route path `report-master` ("Report Master") — list with an inline New/Edit modal. Backed by `/report-types`.

## Database Tables
- **`report_types`** (owned, migration 0038) — `id`, `company_id` (FK), `name`, `description`, `default_mandatory` (bool, default false), `status` (text `Active`|`Inactive`, default `Active`), audit columns, `deleted_at`.
  - Index: `report_types_company_status_idx` on `(company_id, status)` where not deleted. (No unique code column.)
  - RLS: `report_types_company_read` (same company); `report_types_qc_write` — role in **admin/manager/qc** AND same company.

## API Endpoints
All authenticated; writes gated at the DB layer by the qc-write RLS policy (the service itself only calls `requireCompany`, so authorization is enforced by RLS role check).
- `GET /report-types` — list all active (non-deleted) report types, newest first.
- `POST /report-types` — create.
- `PATCH /report-types/:id` — update name/description/defaultMandatory/status.
- `DELETE /report-types/:id` — soft delete.

## Services / Key Functions
- `listReportTypes(user)` -> `{items}` — company-scoped, ordered by `created_at` desc; `toItem` serialises timestamps to ISO.
- `createReportType(input, user)` -> `ReportType`.
- `updateReportType(id, input, user)` -> `ReportType` — verifies same-company existing row; partial patch.
- `deleteReportType(id, user)` -> `{id}` — soft delete (sets `deleted_at`); 404 if not found/already deleted.

## Entry Points
Reached via the QC area as **Report Master** (`report-master` route). Consumed by the QC documents module (`qc-documents`) to classify uploaded reports and flag mandatory ones. Web hooks in `modules/report-types/api.ts` (`useReportTypes`, create/update/delete mutations).

## Business Logic
- No code/uniqueness constraint — identified by `name` (free text); duplicates are not blocked.
- `status` is free text limited to Active/Inactive; `default_mandatory` marks report types required by default in QC flows.
- Authorization for writes is enforced by the `report_types_qc_write` RLS policy (admin/manager/qc); the service layer does not add a role check beyond company membership.
- Soft delete only; list/get exclude deleted rows.

## Dependencies on Other Modules
- Depends on `companies`/`users` (scoping + audit). Depended on by `qc-documents` (report-type classification / mandatory-report checks).

## User Roles / Access
- Read: any authenticated company user. Write: **admin/manager/qc** (RLS `report_types_qc_write`). No dedicated access-control matrix key found (governed via QC/role RLS).

## Reports
This *is* the master that defines report/document types for QC; it does not itself emit a report/export.

## Imports / Exports
None.

## Background Jobs
None.
