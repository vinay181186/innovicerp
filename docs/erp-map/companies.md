# Companies (Company Settings)
**Module key:** `companies` · **Domain:** Master Data

## Purpose
Manages the tenant company record — the legal/letterhead identity (name, GST, address, contact) used across printed documents and as the multi-tenant boundary. Every other table is scoped to a company via `company_id`. There is exactly one company per tenant; this module edits "my" company only.

## Pages / Screens
The web `modules/companies/` directory has no routes of its own. The company edit UI lives in the **Settings** module: `apps/web/src/modules/settings/routes/index.tsx` (route `/settings`), backed by `modules/settings/api.ts` (`useCompany` / `useUpdateCompany` hitting `/companies/me`).
- `/settings` — view and edit the current company's letterhead details (admin only).

## Database Tables
- **`companies`** (owned) — `id`, `name`, `slug`, `gst_number`, `phone`, `email` (letterhead footer, migration 0054), `address_line1/2`, `city`, `state`, `pincode`, audit columns, `deleted_at`.
  - Unique: `companies_slug_uniq` on `slug` where `deleted_at is null`. Index `companies_deleted_at_idx`.
  - No `company_id` column (it *is* the company). `created_by`/`updated_by` FK → `users.id`.
  - RLS: `companies_company_self_read` (`id = current_company_id()`); `companies_admin_write` (role `admin` AND `id = current_company_id()`).

## API Endpoints
- `GET /companies/me` — return the caller's company. Any authenticated user.
- `PATCH /companies/me` — update company letterhead fields. Requires **admin** (`requireAdminRole`).

## Services / Key Functions
- `getMyCompany(user)` → `Company` — load the row for `user.companyId`; 404 if missing.
- `updateMyCompany(input, user)` → `Company` — admin-only patch of name/gst/phone/email/address; blanks are stored as NULL (`emptyToNull`), sets `updatedBy`/`updatedAt`.

## Entry Points
Sidebar → **System Settings → Settings** (`/settings`). Read by nearly every module indirectly (letterhead on printed SO/PO/GRN/DC/invoice documents). `company_id` is the tenant key on every other table.

## Business Logic
- Single-company model: no create/delete endpoints — the tenant company is provisioned out of band. Only self-read + admin update.
- Empty-string inputs are normalised to NULL; `name` is trimmed and required.
- Soft-delete column exists but is never set by app code here.

## Dependencies on Other Modules
- Referenced by every table's `company_id` FK. Consumed by print/letterhead in sales-orders, purchase-orders, goods-receipt-notes, delivery-challans, invoices, etc.
- Depends on `users` (audit FKs) and the `current_company_id()` / `current_user_role()` SQL helpers.

## User Roles / Access
- Read: any authenticated user in the company. Write: **admin** only (service `requireAdminRole` + RLS `companies_admin_write`). No access-control matrix key — gated purely on the admin role.

## Reports
None directly. Feeds company header/letterhead onto printed documents in other modules.

## Imports / Exports
None.

## Background Jobs
None.
