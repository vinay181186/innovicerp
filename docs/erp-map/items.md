# Items Master
**Module key:** `items` · **Domain:** Catalog & Engineering

## Purpose
The master catalog of every part/product the company makes, buys, or assembles. Every other engineering and production record (BOM lines, route cards, plans, job cards, tool issues, stock) references an item. Defines item identity only — stock quantities live in Store.

## Pages / Screens
Web routes under `apps/web/src/modules/items/routes/`:
- `items` (list.tsx) — searchable/paginated item list with type filter; Excel template download + import.
- `items/$id` (detail.tsx) — single item detail, drawing view/print.
- `items/new` (edit.tsx) — create a new item.
- `items/$id/edit` (edit.tsx) — edit an existing item.

## Database Tables
`items` (schema.ts L199):
- Key columns: `code`, `name`, `description`, `drawing_no`, `revision` (default 'A'), `material`, `uom` (uomEnum, default 'NOS'), `item_type` (itemTypeEnum, default 'component'), `hsn_code`, `drawing_file_path`, `min_stock_qty` (int, default 0 — drives low-stock alert).
- Audit + soft delete: `company_id`, `created_at/by`, `updated_at/by`, `deleted_at`.
- Indexes: `items_company_code_uniq` (partial unique on company_id+code where not deleted), `items_company_id_idx`, `items_company_type_idx`.
- RLS: `items_company_read` (select within company), `items_manager_write` (admin/manager write within company). `company_id` on every row.

## API Endpoints
`apps/api/src/modules/items/routes.ts` (all require auth):
- GET `/items` — list; parses `listItemsQuerySchema` (search, itemType, sort, limit, offset).
- GET `/items/:id` — single item.
- POST `/items` — create (201). Write role.
- PATCH `/items/:id` — partial update. Write role.
- DELETE `/items/:id` — soft delete (204). Write role.

## Services / Key Functions
`service.ts` (all wrapped in `withUserContext` tx; all require a company):
- `listItems(query, user)` → `{items,total,limit,offset}` — search by code/name (ILIKE), filter by itemType, sort by code|name.
- `getItem(id, user)` → `Item` — 404 if not found/deleted.
- `createItem(input, user)` → `Item` — requireWriteRole; rejects duplicate active code with ConflictError; emits activity log CREATE.
- `updateItem(id, input, user)` → `Item` — requireWriteRole; field-by-field patch; emits EDIT.
- `softDeleteItem(id, user)` → `{ok:true}` — requireWriteRole; sets deleted_at; emits DELETE.

## Entry Points
Sidebar/nav → Items. Reached indirectly whenever another module needs an item picker (BOM lines, route cards, plans, tool issues). Excel import launched from the list page toolbar.

## Business Logic
- Item code is unique per company among non-deleted rows (DB partial unique index + service ConflictError pre-check).
- `revision` defaults to 'A'; `uom` and `item_type` validated against shared enums.
- Soft delete only (`deleted_at`), never hard delete. All lists filter `deleted_at IS NULL`.
- Write operations gated by `requireWriteRole` (service) plus RLS (admin/manager).
- Every create/edit/delete emits an `activity_log` row (entity='Item', refId=code).
- Stock is deliberately NOT stored here (import template drops the legacy Stock Qty column).

## Dependencies on Other Modules
- `activity-log` — emits audit rows via `emitActivityLog`.
- Referenced BY: bom-master (child items), route-cards (item_id), plans, assembly, tool-issues, job-cards, store. Items is a foundational master with no upstream dependency.

## User Roles / Access
- Read: any authenticated user in the company (RLS `items_company_read`).
- Write (create/edit/delete): admin/manager only (service `requireWriteRole` + RLS `items_manager_write`).

## Reports
None dedicated. Item data feeds stock-valuation, store-inventory, and BOM/route reporting elsewhere.

## Imports / Exports
Excel import/template on the web list page — `apps/web/src/modules/items/lib/import-export.ts` (SheetJS/`xlsx`):
- `downloadItemTemplate()` — writes `ItemMaster_ImportTemplate.xlsx` with columns: Item Code*, Name*, Description, Drawing No., Revision, Material, UOM, Item Type (+ one sample row). Required columns marked `*`.
- `parseItemImportFile(file)` → `{payloads, errors}` — reads first sheet; per-row: skips fully blank rows; requires Item Code and Name (else row error); rejects codes repeated within the file; normalizes UOM (invalid→'NOS') and Item Type (invalid→'component') against shared enums; defaults Revision to 'A'. Tolerant header aliasing (e.g. "Item Code*" / "Code" / "code").
- Import calls `useCreateItem` per payload; the list banner surfaces added codes vs failed/duplicate codes (see recent commits). Also drawing file upload/print in `lib/print-drawing.ts` and `components/drawing-upload-field.tsx`.

## Background Jobs
None.
