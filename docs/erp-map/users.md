# Users (User Management)
**Module key:** `users` · **Domain:** Master Data

## Purpose
Manages application login accounts within a company: creating them, assigning a role, activating/deactivating, resetting passwords, and setting a per-user PO approval limit. Each `public.users` row is 1:1 with a Supabase Auth account (same UUID).

## Pages / Screens
`apps/web/src/modules/users/routes/` (route path `users` under `_authenticated`):
- `list.tsx` — `/users` User Management list (search, role/active filters, paginated).
- `create.tsx` — create a new user (email, full name, role, initial password, active flag, approval limit).
- `edit.tsx` — edit role/name/phone/active/approval limit, set password, soft-delete.

## Database Tables
- **`users`** (owned) — `id` (== auth.users uid, no default), `company_id` (nullable FK → companies), `email`, `full_name`, `role` (`userRoleEnum`, default `viewer`), `phone`, `is_active` (default false), `approval_limit` numeric(14,2) (per-user PO limit, migration 0046; NULL ⇒ fall back to `approval_config.po_manager_limit`), audit columns, `deleted_at`.
  - Unique: `users_email_uniq` on `email` where `deleted_at is null`. Index `users_company_id_idx` where not deleted.
  - RLS: `users_company_read` (`company_id = current_company_id()`); `users_manager_update` (role in admin/manager AND same company).
- Also touches **Supabase `auth.users`** via the admin API (create/update password). A DB trigger `on_auth_user_created` seeds a `public.users` row (role=viewer, is_active=false, company_id=NULL) on auth insert.

## API Endpoints
All require authentication; all service functions require **admin** (`requireAdminRole`).
- `GET /users` — list users (search, role, isActive filters, limit/offset).
- `POST /users` — create user (201).
- `GET /users/:id` — fetch one user.
- `PATCH /users/:id` — update role/name/phone/active/approvalLimit.
- `POST /users/:id/set-password` — admin resets another user's password (204).
- `DELETE /users/:id` — soft-delete user (204).

## Services / Key Functions
- `listUsers(input, user)` → `{items,total,limit,offset}` — admin-only, company-scoped, search on name/email.
- `createUser(input, user)` → `User` — creates the Supabase Auth account (email pre-confirmed), then promotes the trigger-seeded `public.users` row into the company with role/limit. **Revives** a previously soft-deleted/orphaned account on duplicate email (ADR-050); refuses a live company-assigned duplicate. Uses RLS-bypassing `db` client for the promote step since the fresh row has `company_id=NULL`.
- `getUser(id, user)` → `User`.
- `updateUser(id, input, user)` → `User` — guards **self-demotion** and **self-deactivation**; verifies target is in the admin's company.
- `setUserPassword(id, input, user)` → `{ok:true}` — verifies target is a live same-company user, then sets password via Supabase admin (no email; immune to email rate limit, ADR-049).
- `softDeleteUser(id, user)` → `{ok:true}` — blocks self-delete; sets `deleted_at` + `is_active=false`. Auth account is never removed.

## Entry Points
Sidebar → **System Settings → User Management** (`/users`). Roles here drive authorization everywhere (write role, admin role, op-entry role, qc role checks in `lib/auth`). `approval_limit` is read by the purchase-orders approval flow.

## Business Logic
- `public.users.id === auth.users.id`; both addressed by the same UUID.
- Admin-provisioned accounts skip email verification (`email_confirm: true`).
- Duplicate-email create → revive if existing profile is soft-deleted or `company_id` is NULL; else `ConflictError`.
- Self-protection: cannot demote yourself from admin, cannot deactivate yourself, cannot delete yourself.
- `approval_limit` stored as a numeric string; NULL clears it (admin is always unlimited via service check elsewhere).
- Soft delete only; deactivation also flips `is_active=false`.

## Dependencies on Other Modules
- Uses `lib/supabase-admin` (Supabase Auth admin API) and the plain `db` client.
- Every module depends on this module's `role` for authorization; purchase-orders reads `approval_limit`. `operators.user_id` optionally links an operator to a user account.

## User Roles / Access
- All operations **admin only** (service `requireAdminRole`; RLS additionally allows manager updates at the DB layer, but the service restricts to admin). Access-control matrix key: `user_manage` (dept `system`, label "User Management").

## Reports
None.

## Imports / Exports
None.

## Background Jobs
None (synchronous Supabase Auth admin calls).
