# BOM Master
**Module key:** `bom-master` · **Domain:** Catalog & Engineering

## Purpose
Bill of Materials master: defines the child items (and their per-set quantity + sourcing type) that make up an assembled/manufactured product. Carries a full revision history and drives the BOM→SO-line cascade that auto-spawns Job Cards and Purchase Requests for each child.

## Pages / Screens
Web routes under `apps/web/src/modules/bom-master/routes/`:
- `bom-masters` (list.tsx) — searchable list with status filter; per-row line count + linked-SO count.
- `bom-masters/$id` (detail.tsx) — header, child lines, revision history, linked-SO count.
- `bom-masters/new` (new.tsx) — create a BOM.
- `bom-masters/$id/edit` (edit.tsx) — edit (bumps revision).

## Database Tables
- `bom_masters` (L2043) — header: `bom_no`, `bom_name`, `revision` (int, default 1), `status` (bomStatusEnum, default 'draft'), `revision_date`. Unique `bom_masters_company_no_uniq` (company+bom_no, partial). Index on company+status. RLS company_read / manager_write.
- `bom_master_lines` (L2086) — one row per child: `line_no`, `child_item_id` (→items), `qty_per_set` numeric(12,2), `bom_type` (bomLineTypeEnum: manufacture/purchase/outsource). Unique `bom_master_lines_bom_item_uniq` (bom+child_item). CHECK `qty_per_set > 0`. Indexes on bom_master_id, child_item_id.
- `bom_master_revisions` (L2137) — append-only audit: `revision`, `changed_by_text`, `notes`, `items_snapshot` jsonb. Unique (bom+revision). Insert-only RLS (no update/delete policy).

All three: `company_id`, full audit columns, soft delete (revisions insert-only).

## API Endpoints
`routes.ts` (auth required):
- GET `/bom-masters` — list (`listBomMastersQuerySchema`: search, status, limit, offset).
- GET `/bom-masters/:id` — detail.
- POST `/bom-masters` — create (201). Write role.
- PUT `/bom-masters/:id` — full update / new revision. Write role.
- DELETE `/bom-masters/:id` — soft delete. Admin only.

## Services / Key Functions
`service.ts` (all in `withUserContext` tx):
- `listBomMasters(query, user)` → list with lineCount + linkedSoCount (raw SQL with LATERAL joins).
- `getBomMaster(id, user)` → detail (header + lines joined to item code/name + revisions + linkedSoCount).
- `createBomMaster(input, user)` → detail — writes revision=1 + initial revision snapshot.
- `updateBomMaster(id, input, user)` → detail — bumps revision, snapshots PRE-update lines, replaces lines.
- `softDeleteBomMaster(id, user)` → header — admin only; blocked if any non-cancelled SO line links the BOM.
- `computeBomDiffNote(oldLines, newLines)` — exported helper producing human-readable Added/Removed/Changed note.
- `cascadeBomToSoLine(tx, soLineId, user)` (cascade.ts) → spawns child JC/PR from BOM lines.

## Entry Points
Nav → BOM Master. The cascade (`cascade.ts`) fires from the sales-orders module after an SO line with `source_bom_master_id` is inserted.

## Business Logic
- `bom_no` auto-generated as `BOM-NNNN` (next numeric suffix per company) when not supplied; user-supplied numbers are dup-checked.
- Revision lifecycle: create writes revision 1 + snapshot ("Initial creation"); update bumps revision by 1, snapshots the PRE-update lines, auto-generates a diff note when the caller doesn't supply one.
- Line rows are hard-deleted and re-inserted on update (pre-state preserved in the revision snapshot); all-or-nothing in one transaction.
- Delete guard: refuses if any non-cancelled `sales_order_lines` has `source_bom_master_id = this.id` (ConflictError "linked to N sales order line(s)"). Delete is admin-only.
- Child item ids validated to exist (ValidationError listing missing ids). `qty_per_set > 0` enforced in DB.
- **BOM→SO cascade** (cascade.ts): child qty = `soLine.orderQty × bomLine.qtyPerSet`. Per bom_type — manufacture→child `job_cards` row (sourceSoLineId=parent line); purchase→`purchase_requests` (vendor 'TBD'); outsource→`purchase_requests` with `operation='OUTSOURCE'`. Idempotent: no-op if any child JC/PR already references the SO line. Emits `BOM_CASCADE` activity log.
- Audit: CREATE/EDIT/DELETE emit `activity_log` entity='BOM'.

## Dependencies on Other Modules
- `items` — child item validation + code/name display.
- `sales-orders` (`sales_order_lines`) — link/delete guard + cascade source.
- `job-cards`, `purchase-requests` — cascade targets.
- `activity-log` — audit + cascade events.
- Referenced BY: `plans` (bom_master_id), `assembly` (BOM readiness rollup).

## User Roles / Access
- Read: any authenticated company user (RLS company_read).
- Create/edit: admin/manager (`requireWriteRole` + RLS manager_write).
- Delete: admin only (explicit service check).

## Reports
None dedicated; linkedSoCount surfaces BOM usage. Feeds assembly tracker readiness.

## Imports / Exports
Excel template download + line import inside the BOM form — `apps/web/src/modules/bom-master/components/bom-form.tsx` (dynamic-imported `xlsx`, ~140 KB gzip loaded only when used). Template download + parse populate BOM child lines from a spreadsheet; per-row errors surfaced in an import summary. No PDF/CSV export.

## Background Jobs
None.
