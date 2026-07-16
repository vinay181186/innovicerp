# Vendors (Vendor Master)
**Module key:** `vendors` · **Domain:** Master Data

## Purpose
Master list of suppliers/sub-contractors the company buys from or outsources to. Referenced by Purchase Orders, GRNs, OSP/party-material flows. Codes auto-generate as `VND-###`.

## Pages / Screens
`apps/web/src/modules/vendors/routes/` (route path `vendors`):
- `list.tsx` — `/vendors` Vendor Master list (search, active filter, sort by code/name, paginated) plus Excel Template + Import controls.
- `detail.tsx` — read view of a single vendor.
- `edit.tsx` — create/edit form (contact, GST, address, materials supplied, rating, active).

## Database Tables
- **`vendors`** (owned) — `id`, `company_id` (FK), `code`, `name`, `contact_person`, `email`, `phone`, `gst_number`, `address_line1`, `city`, `state`, `pincode`, `materials_supplied`, `rating`, `is_active` (default true), audit columns, `deleted_at`.
  - Unique: `vendors_company_code_uniq` on `(company_id, code)` where `deleted_at is null`. Index `vendors_company_id_idx` where not deleted.
  - RLS: `vendors_company_read` (same company); `vendors_manager_write` (admin/manager AND same company).

## API Endpoints
- `GET /vendors` — list (search, isActive, sortBy code|name, sortDir).
- `GET /vendors/:id` — fetch one.
- `POST /vendors` — create (201). Requires write role.
- `PATCH /vendors/:id` — update. Requires write role.
- `DELETE /vendors/:id` — soft delete (204). Requires write role.

## Services / Key Functions
- `listVendors(input, user)` → `{vendors,total,limit,offset}` — company-scoped, ilike search on code/name.
- `getVendor(id, user)` → `Vendor`.
- `createVendor(input, user)` → `Vendor` — write role; auto-generates `VND-###` via `nextVendorCode` (legacy `_nextVendorCode`, 3-digit MAX+1) when no code supplied; `withUniqueRetry` around concurrent code collisions; explicit active-duplicate check → `ConflictError`.
- `updateVendor(id, input, user)` → `Vendor` — includes `materials_supplied` and `rating`.
- `softDeleteVendor(id, user)` → `{ok:true}`.

## Entry Points
Sidebar → **Purchase → Vendor Master** (`/vendors`). Read by purchase-orders, goods-receipt-notes, service-pos, osp-processes, party-materials/party-grn (vendor pickers).

## Business Logic
- Server-authoritative vendor code `VND-` + zero-padded MAX+1; manual code accepted if provided.
- Uniqueness on `(company_id, code)` among non-deleted rows; concurrent races handled by `withUniqueRetry`.
- Empty strings normalised to NULL. Soft delete only.

## Dependencies on Other Modules
- Depends on `companies`/`users` (scoping + audit). Depended on by purchase-orders, goods-receipt-notes, service-pos, osp-processes, and party-material modules.

## User Roles / Access
- Read: any authenticated company user. Write: **admin/manager** (`requireWriteRole` + RLS `vendors_manager_write`). Access-control matrix key: `vendor_create` (dept `purchase`, label "Vendor Master").

## Reports
None directly; vendor identity flows into procurement reports.

## Imports / Exports
- **Excel import + template** — `apps/web/src/modules/vendors/lib/import-export.ts` (SheetJS/`xlsx`): `downloadVendorTemplate()` produces a blank .xlsx; an importer parses vendor rows into `CreateVendorInput` payloads. Columns: Code*, Name*, Contact Person, Phone, Email, GST No., Address, City, State, PIN, Materials/Services, Rating (A/B/C), Status. Delta vs legacy: address components kept separate; Status "Inactive" → `isActive=false`; rating keeps first letter. Wired from `routes/list.tsx`.

## Background Jobs
None (import is client-side parse → per-row create calls).
