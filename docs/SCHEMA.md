# SCHEMA.md — Living Database Schema

> MUST mirror `apps/api/src/db/schema.ts` exactly. Update in same commit as schema changes.

## Conventions

Every table has:
- `id uuid primary key default gen_random_uuid()`
- `company_id uuid not null references companies(id)`
- `created_at timestamptz not null default now()`
- `created_by uuid not null references users(id)`
- `updated_at timestamptz not null default now()`
- `updated_by uuid not null references users(id)`
- `deleted_at timestamptz` (null = active)
- RLS enabled with `company_isolation` policy at minimum

## Modules (planned — table-by-table specs added as built)

| Group | Tables | Replaces (Firestore Collections) |
|---|---|---|
| Master Data | companies, users, clients, vendors, items, machines, operators | companies, users, clients, vendors, items, machines, operators |
| Sales & Production | sales_orders, sales_order_lines, job_work_orders, job_cards, jc_ops, op_log | salesOrders, jobWorkOrders, jobCards, jcOps, opLog, runningOps |
| Procurement | purchase_orders, po_lines, grn, grn_lines, store_transactions | purchaseRequests, purchaseOrders, grn, storeTransactions, storeIssues |
| Quality | qc_inspections, qc_attachments, nc_register, capa_records | qcProcesses, qcAssignments, qcDocUploads, ncRegister, capaRecords |
| Dispatch | dispatch_log (with direction enum), delivery_challans | jwDCOutward, jwDCInward, challans, dispatchLog |
| Design | design_projects, design_tasks, design_issues, design_work_log, design_dcrs, design_dcns | designProjects, designTasks, designIssues, designWorkLog, designTimeLog, designDCRs, designDCNs |
| CRM | leads, communications, crm_reminders | leads, communications, crmReminders |
| Outsource | outsource_jobs, osp_process_config, osp_dc, service_pos | outsourceJobs, ospProcessConfig, ospDC, servicePOs |
| Audit & Config | activity_log, dashboard_config, alert_config, print_templates, print_template_revisions | activityLog, trash, dashboardConfig, alertConfig, printTemplates, printTemplateRevisions, stuckThresholds, reportTypes |

Total target: ~41 tables (replacing 65 Firestore collections — count corrected in T-013, originally documented as 67).

## RLS Policy Pattern

```sql
alter table <table_name> enable row level security;

create policy company_isolation on <table_name>
  for all using (company_id = current_company_id());
```

Tables with role-restricted writes get additional policies (e.g., admin/manager only for inserts on master data, operator-only for op_log inserts).

## Index Discipline

MUST have indexes:
- Every foreign key column (Postgres does NOT auto-index FKs)
- `(company_id, status) where deleted_at is null` on transaction tables
- Time-range columns used in reports
- Unique business keys (`so_number`, `jc_number`, `po_number`, etc.)

## Helper Functions (created in T-003, applied in T-005)

```sql
-- Read company_id claim from JWT (set by Fastify auth plugin via SET LOCAL)
create or replace function current_company_id() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb->>'company_id', '')::uuid
$$;

-- Read role claim from JWT
create or replace function current_user_role() returns text
language sql stable as $$
  select current_setting('request.jwt.claims', true)::jsonb->>'role'
$$;

-- Trigger that bumps updated_at on every UPDATE
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
```

Each table gets a `before update` trigger calling `set_updated_at()`. RLS expects the API to inject `company_id` and `role` into the JWT claims and propagate via `set_config('request.jwt.claims', ..., true)` per-transaction.

---

## Phase 1 Tables

Three tables only. Everything else gets designed at the start of its phase, just-in-time.

### `companies`

The multi-tenant root. Every other row in the system has `company_id → companies(id)`.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK, `default gen_random_uuid()` |
| `name` | `text` | not null |
| `slug` | `text` | not null, unique. URL-safe identifier |
| `gst_number` | `text` | nullable. Indian GSTIN (15 chars), validated server-side |
| `phone` | `text` | nullable. Single contact phone (E.164 or local format) |
| `address_line1` | `text` | nullable |
| `address_line2` | `text` | nullable |
| `city` | `text` | nullable |
| `state` | `text` | nullable |
| `pincode` | `text` | nullable |
| `created_at` | `timestamptz` | not null, default `now()` |
| `created_by` | `uuid` | not null, references `users(id)`. (Bootstrap row uses a sentinel — see Migration Notes.) |
| `updated_at` | `timestamptz` | not null, default `now()` |
| `updated_by` | `uuid` | not null, references `users(id)` |
| `deleted_at` | `timestamptz` | nullable (soft delete) |

**Indexes:**
- `unique (slug) where deleted_at is null` — slug reusable after soft delete
- `(deleted_at)` — partial filter helper

**RLS:**
```sql
alter table companies enable row level security;

-- Users see only their own company
create policy company_self_read on companies
  for select using (id = current_company_id());

-- Only platform-level "admin" role (root admin) can insert/update/delete companies
create policy company_admin_write on companies
  for all using (current_user_role() = 'admin' and id = current_company_id())
  with check (current_user_role() = 'admin' and id = current_company_id());
```

### `users`

Mirror of `auth.users` with org context. PK matches `auth.users.id` exactly.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK, references `auth.users(id) on delete cascade` |
| `company_id` | `uuid` | nullable on insert, set by admin after invite. References `companies(id)` |
| `email` | `text` | not null. Mirrored from `auth.users.email`; updated by trigger if changed |
| `full_name` | `text` | nullable |
| `role` | `user_role` | not null, default `'viewer'` |
| `phone` | `text` | nullable |
| `is_active` | `boolean` | not null, default `false`. Set true by admin after company assignment |
| `created_at`, `created_by`, `updated_at`, `updated_by`, `deleted_at` | (audit pattern) | `created_by`/`updated_by` reference `users(id)` |

**Enum:**
```sql
create type user_role as enum (
  'admin',     -- platform admin (cross-company; rare)
  'manager',   -- company-level admin
  'operator',  -- shop floor worker
  'qc',        -- quality control
  'procurement',
  'dispatch',
  'design',
  'viewer'     -- read-only
);
```

**Indexes:**
- `(company_id) where deleted_at is null`
- `(email) where deleted_at is null`

**RLS:**
```sql
alter table users enable row level security;

-- Users see all users in their own company (for assignment dropdowns, audit views)
create policy users_company_read on users
  for select using (company_id = current_company_id());

-- Only managers/admins can update users (assign company_id, role, is_active)
create policy users_manager_write on users
  for update using (current_user_role() in ('admin', 'manager') and company_id = current_company_id())
  with check (current_user_role() in ('admin', 'manager') and company_id = current_company_id());

-- Self-update of own profile fields (full_name, phone) — enforced via service layer column whitelist, not RLS
```

**Auto-provision trigger** (per ADR-008 / user choice for option a):

```sql
-- Fires after a row is inserted into auth.users (Supabase signup or admin create)
create or replace function handle_new_auth_user() returns trigger
language plpgsql security definer as $$
begin
  insert into public.users (id, email, full_name, role, is_active, created_by, updated_by)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    'viewer',         -- default until admin assigns
    false,            -- inactive until admin sets company_id and approves
    new.id,           -- self-bootstrap; updated_by=created_by=self
    new.id
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();
```

**Email-change sync trigger** (keep `public.users.email` in step with `auth.users.email`):

```sql
create or replace function sync_auth_user_email() returns trigger
language plpgsql security definer as $$
begin
  update public.users set email = new.email, updated_at = now() where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (new.email is distinct from old.email)
  execute function sync_auth_user_email();
```

### `items`

Master template. Mirror of legacy `items` collection. Reference module for the entire codebase.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` |
| `company_id` | `uuid` | not null, references `companies(id)` |
| `code` | `text` | not null. Business key (e.g. `ITM-001`) |
| `name` | `text` | not null |
| `description` | `text` | nullable |
| `drawing_no` | `text` | nullable |
| `revision` | `text` | not null, default `'A'` |
| `material` | `text` | nullable. Free text (e.g. `EN8`, `SS304`) |
| `uom` | `uom` | not null, default `'NOS'` |
| `item_type` | `item_type` | not null, default `'component'` |
| `hsn_code` | `text` | nullable. India tax classification |
| `drawing_file_path` | `text` | nullable. Supabase Storage path; replaces legacy base64 `drawingData` blob |
| `created_at`, `created_by`, `updated_at`, `updated_by`, `deleted_at` | (audit pattern) | |

**Enums:**
```sql
create type uom as enum ('NOS', 'KGS', 'SET', 'MTR');
create type item_type as enum ('component', 'assembly');
```

(Both kept tight — `assembly | component` matches legacy line 7051/7071/7088. UOM matches the 4 hard-coded values in legacy `itemForm` line 11549. Expand only via migration when a real new value is needed.)

**Indexes:**
- `unique (company_id, code) where deleted_at is null` — code reusable after soft delete
- `(company_id) where deleted_at is null`
- `(company_id, item_type) where deleted_at is null` — for assembly/component filtering

**RLS:**
```sql
alter table items enable row level security;

create policy items_company_read on items
  for select using (company_id = current_company_id());

create policy items_manager_write on items
  for all
  using (current_user_role() in ('admin', 'manager') and company_id = current_company_id())
  with check (current_user_role() in ('admin', 'manager') and company_id = current_company_id());
```

---

## Phase 2 Tables — Master Data (clients, vendors, machines, operators)

Storage layer only. API + Web modules ship in T-022 (admin screens). Designed in T-014 with the migration's transform layer; loaded in T-015.

All four tables follow the **items pattern**:
- `id uuid pk default gen_random_uuid()`
- `company_id uuid not null → companies(id)`
- `code text not null` (business key, unique within company while not soft-deleted)
- audit columns + `deleted_at`
- `before update` trigger calling `set_updated_at()`
- 2 RLS policies: `<table>_company_read` (any role, same company) and `<table>_manager_write` (admin/manager only)

No new enums — vendor `rating` and machine `status` kept as `text` for forward flexibility.

### `clients`

Customer master. Replaces legacy `clients` collection (1 record at T-013 export).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `company_id` | `uuid` | not null, FK → `companies(id)` |
| `code` | `text` | not null. Business key (e.g. `L&T_1`) |
| `name` | `text` | not null |
| `contact_person` | `text` | nullable. Legacy `contact` field |
| `email` | `text` | nullable |
| `phone` | `text` | nullable. (Not in legacy schema; added forward.) |
| `gst_number` | `text` | nullable. Indian GSTIN |
| `address_line1` | `text` | nullable. Legacy `address` collapsed here |
| `city`, `state`, `pincode` | `text` | nullable |
| `is_active` | `boolean` | not null, default `true` |
| audit + `deleted_at` | (audit pattern) | |

Indexes: `unique (company_id, code) where deleted_at is null`, `(company_id) where deleted_at is null`.

### `vendors`

Supplier master. Replaces legacy `vendors` (3 records).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `company_id` | `uuid` | not null, FK |
| `code` | `text` | not null. Legacy `code` (e.g. `VND-001`) |
| `name` | `text` | not null |
| `contact_person` | `text` | nullable. Legacy `contact` |
| `email` | `text` | nullable |
| `phone` | `text` | nullable |
| `gst_number` | `text` | nullable. Legacy `gst` |
| `address_line1` | `text` | nullable. Legacy `address` |
| `city`, `state`, `pincode` | `text` | nullable |
| `materials_supplied` | `text` | nullable. Legacy `materials` (free-form, e.g. `EN8, EN24, EN31`) |
| `rating` | `text` | nullable. Legacy `rating` (free `A`/`B`/`C` etc.) |
| `is_active` | `boolean` | not null, default `true`. Derived from legacy `status === 'Active'` |
| audit + `deleted_at` | (audit pattern) | |

Indexes: `unique (company_id, code) where deleted_at is null`, `(company_id) where deleted_at is null`.

### `machines`

Shop-floor equipment master. Replaces legacy `machines` (12 records).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `company_id` | `uuid` | not null, FK |
| `code` | `text` | not null. Legacy `machineId` (e.g. `CNC-01`) |
| `name` | `text` | not null. Legacy `name` (e.g. `DX-200 5A`) |
| `machine_type` | `text` | nullable. Legacy `type` (often empty) |
| `capacity_per_shift` | `integer` | nullable. Legacy `capPerShift` |
| `shifts_per_day` | `integer` | not null, default `1`. Legacy `shifts` |
| `status` | `text` | not null, default `'Idle'`. Legacy `status` (`Running`/`Idle`/`Down`/`Maintenance`) |
| audit + `deleted_at` | (audit pattern) | |

Indexes: `unique (company_id, code) where deleted_at is null`, `(company_id) where deleted_at is null`, `(company_id, status) where deleted_at is null` (for the live operations board, Phase 3+).

### `operators`

Shop-floor worker master. Replaces legacy `operators` (1 record).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `company_id` | `uuid` | not null, FK |
| `code` | `text` | not null. Legacy `opId` (e.g. `VNM`) |
| `name` | `text` | not null |
| `department` | `text` | nullable |
| `skills` | `text` | nullable. Free-form (e.g. `CNC, Welding`); junction table only if it earns its keep |
| `is_active` | `boolean` | not null, default `true` |
| `user_id` | `uuid` | **nullable**, FK → `users(id)`. Set when an operator also has a login; null for shop-floor-only |
| audit + `deleted_at` | (audit pattern) | |

Indexes: `unique (company_id, code) where deleted_at is null`, `(company_id) where deleted_at is null`, `(user_id) where deleted_at is null` (for finding operators by their login).

---

## Migration Notes (Phase 1 bootstrap)

The chicken-and-egg of `companies.created_by → users.id` and `users.company_id → companies.id` is resolved this way:

1. Initial migration creates both tables with FKs as `deferrable initially deferred`.
2. Seed inserts the first company and the first admin user inside one transaction.
3. The admin user is created in `auth.users` first (via Supabase Admin API in a one-shot setup script), the trigger creates the `public.users` row with `is_active=false`, then a SQL UPDATE sets `company_id` and `role='admin'` and `is_active=true`.
4. The `companies` row's `created_by` and `updated_by` point at this admin's id.

A separate setup script `migration/seed-admin.ts` will be added in T-005 / T-008 to do this idempotently.

## Migration History

| Date | Migration | Notes |
|---|---|---|
| 2026-04-30 | `0000_initial.sql` + `0001_post_init.sql` | Phase 1 — companies, users, items + helpers + auth.users triggers (T-005) |
| 2026-04-30 | `0002_phase2_master.sql` (this commit) | Phase 2 storage layer — clients, vendors, machines, operators tables, indexes, RLS, BEFORE UPDATE triggers |
