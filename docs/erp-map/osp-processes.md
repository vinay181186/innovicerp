# OSP Processes (Outside Processing Configuration)
**Module key:** `osp-processes` · **Domain:** Catalog & Engineering

## Purpose
Configuration master for Outside-Processing (OSP) operations — named external processes (e.g. plating, heat treatment) each optionally tied to a default vendor, an auto-PO flag, and a lead time in days. Used to standardize outsource steps referenced by route cards / plans / job work.

## Pages / Screens
No dedicated route folder. Managed inside Settings — `apps/web/src/modules/settings/components/osp-processes-panel.tsx`, surfaced via `apps/web/src/modules/settings/routes/index.tsx`. Web API hooks live in `apps/web/src/modules/osp-processes/api.ts` (no `routes/` dir).

## Database Tables
`osp_processes` (schema.ts L4820):
- Key columns: `process_name`, `vendor_id` (→vendors, nullable), `auto_po` bool (default false), `lead_days` int (default 5).
- Audit + soft delete: `company_id`, `created_at/by`, `updated_at/by`, `deleted_at`.
- Indexes: `osp_processes_company_name_uq` (unique partial on company_id + `lower(process_name)` where not deleted — case-insensitive name uniqueness), `osp_processes_company_idx`.
- RLS: `osp_processes_company_read`, `osp_processes_manager_write` (admin/manager).

## API Endpoints
`routes.ts` (auth required):
- GET `/osp-processes` — list (ordered by name, with joined vendor code/name).
- POST `/osp-processes` — create.
- GET `/osp-processes/:id` — single.
- PATCH `/osp-processes/:id` — update.
- DELETE `/osp-processes/:id` — soft delete (204).

## Services / Key Functions
`service.ts` (all in `withUserContext` tx, all require a company):
- `listOspProcesses(user)` → `{items}` — left-joins vendors for code/name display.
- `createOspProcess(input, user)` → OspProcess — requireWriteRole; case-insensitive duplicate-name guard; `auto_po` forced false unless a vendor is set.
- `getOspProcess(id, user)` → OspProcess — 404 if missing.
- `updateOspProcess(id, input, user)` → OspProcess — requireWriteRole; dup-name guard excluding self.
- `softDeleteOspProcess(id, user)` → `{ok:true}` — requireWriteRole.

## Entry Points
Settings page → OSP Processes panel. Mirrors legacy Settings OSP block (`_addOspProcess` / `_editOspProcess` / `_delOspProcess`).

## Business Logic
- Process name is unique per company case-insensitively (DB partial unique on `lower(process_name)` + service ValidationError pre-check on create and update).
- `auto_po` is coerced to false whenever no `vendor_id` is provided (`autoPo && !!vendorId`) — auto-PO is meaningless without a default vendor.
- `lead_days` defaults to 5.
- `process_name` trimmed on write.
- Soft delete only; all lists filter `deleted_at IS NULL`.
- No activity-log emission in this module.

## Dependencies on Other Modules
- `vendors` — optional default vendor (id + code/name display).
- Conceptually referenced by route-cards / plans / job-work outsource steps (those store their own vendor refs; OSP processes provide the named-process catalog + defaults).

## User Roles / Access
- Read: any authenticated company user (RLS company_read).
- Create/edit/delete: admin/manager (`requireWriteRole` + RLS manager_write).

## Reports
None.

## Imports / Exports
None.

## Background Jobs
None. (`auto_po` is a configuration flag; no queue/scheduler consumes it in this module.)
