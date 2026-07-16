# Clients (Client Master)
**Module key:** `clients` · **Domain:** Master Data

## Purpose
Master list of customers/clients the company sells to. Client records are referenced by Sales Orders and downstream sales/dispatch documents. Codes auto-generate as `CLI-###`.

## Pages / Screens
`apps/web/src/modules/clients/routes/` (route path `clients`):
- `list.tsx` — `/clients` Client Master list (search on code/name, active filter, sort by code/name, paginated).
- `detail.tsx` — read view of a single client.
- `edit.tsx` — create/edit form (contact, GST, address, active flag).

## Database Tables
- **`clients`** (owned) — `id`, `company_id` (FK), `code`, `name`, `contact_person`, `email`, `phone`, `gst_number`, `address_line1`, `city`, `state`, `pincode`, `is_active` (default true), audit columns, `deleted_at`.
  - Unique: `clients_company_code_uniq` on `(company_id, code)` where `deleted_at is null`. Index `clients_company_id_idx` where not deleted.
  - RLS: `clients_company_read` (same company); `clients_manager_write` (role in admin/manager AND same company).

## API Endpoints
- `GET /clients` — list (search, isActive, sortBy code|name, sortDir).
- `GET /clients/:id` — fetch one.
- `POST /clients` — create (201). Requires write role.
- `PATCH /clients/:id` — update. Requires write role.
- `DELETE /clients/:id` — soft delete (204). Requires write role.

## Services / Key Functions
- `listClients(input, user)` → `{clients,total,limit,offset}` — company-scoped, ilike search on code/name.
- `getClient(id, user)` → `Client`.
- `createClient(input, user)` → `Client` — write role; auto-generates `CLI-###` via `nextClientCode` (MAX+1, 3-digit) when no code supplied; wrapped in `withUniqueRetry` so concurrent code collisions (23505) retry with the next code; explicit active-duplicate check → `ConflictError`.
- `updateClient(id, input, user)` → `Client`.
- `softDeleteClient(id, user)` → `{ok:true}`.

## Entry Points
Sidebar → **Sales → Client Master** (`/clients`). Read by the Sales Orders module (client picker/dropdown) and downstream sales/dispatch/invoice documents.

## Business Logic
- Server-authoritative client code: `CLI-` + zero-padded MAX+1 across the company series (fixes legacy manual-entry bug 5.1). Manual code accepted if provided.
- Uniqueness on `(company_id, code)` among non-deleted rows; concurrent-create races handled by `withUniqueRetry`.
- Empty strings normalised to NULL. `is_active` toggles visibility in pickers, not deletion.
- Soft delete only (`deleted_at`); list/get filter out deleted rows.

## Dependencies on Other Modules
- Depends on `companies`/`users` (scoping + audit FKs). Depended on by `sales-orders` (and downstream SO-based modules) which reference the client.

## User Roles / Access
- Read: any authenticated user in the company. Write (create/edit/delete): **admin/manager** (`requireWriteRole` + RLS `clients_manager_write`). Access-control matrix key: `client_create` (dept `sales`, label "Client Master").

## Reports
None directly; client identity flows into SO-based reports.

## Imports / Exports
None.

## Background Jobs
None.
