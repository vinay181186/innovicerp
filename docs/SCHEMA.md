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

| Group              | Tables                                                                                  | Replaces (Firestore Collections)                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Master Data        | companies, users, clients, vendors, items, machines, operators                          | companies, users, clients, vendors, items, machines, operators                                                         |
| Sales & Production | sales_orders, sales_order_lines, job_work_orders, job_cards, jc_ops, op_log             | salesOrders, jobWorkOrders, jobCards, jcOps, opLog, runningOps                                                         |
| Procurement        | purchase_orders, po_lines, grn, grn_lines, store_transactions                           | purchaseRequests, purchaseOrders, grn, storeTransactions, storeIssues                                                  |
| Quality            | qc_inspections, qc_attachments, nc_register, capa_records                               | qcProcesses, qcAssignments, qcDocUploads, ncRegister, capaRecords                                                      |
| Dispatch           | dispatch_log (with direction enum), delivery_challans                                   | jwDCOutward, jwDCInward, challans, dispatchLog                                                                         |
| Design             | design_projects, design_tasks, design_issues, design_work_log, design_dcrs, design_dcns | designProjects, designTasks, designIssues, designWorkLog, designTimeLog, designDCRs, designDCNs                        |
| CRM                | leads, communications, crm_reminders                                                    | leads, communications, crmReminders                                                                                    |
| Outsource          | outsource_jobs, osp_process_config, osp_dc, service_pos                                 | outsourceJobs, ospProcessConfig, ospDC, servicePOs                                                                     |
| Audit & Config     | activity_log, dashboard_config, alert_config, print_templates, print_template_revisions | activityLog, trash, dashboardConfig, alertConfig, printTemplates, printTemplateRevisions, stuckThresholds, reportTypes |

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

| Column          | Type          | Notes                                                                                    |
| --------------- | ------------- | ---------------------------------------------------------------------------------------- |
| `id`            | `uuid`        | PK, `default gen_random_uuid()`                                                          |
| `name`          | `text`        | not null                                                                                 |
| `slug`          | `text`        | not null, unique. URL-safe identifier                                                    |
| `gst_number`    | `text`        | nullable. Indian GSTIN (15 chars), validated server-side                                 |
| `phone`         | `text`        | nullable. Single contact phone (E.164 or local format)                                   |
| `address_line1` | `text`        | nullable                                                                                 |
| `address_line2` | `text`        | nullable                                                                                 |
| `city`          | `text`        | nullable                                                                                 |
| `state`         | `text`        | nullable                                                                                 |
| `pincode`       | `text`        | nullable                                                                                 |
| `created_at`    | `timestamptz` | not null, default `now()`                                                                |
| `created_by`    | `uuid`        | not null, references `users(id)`. (Bootstrap row uses a sentinel — see Migration Notes.) |
| `updated_at`    | `timestamptz` | not null, default `now()`                                                                |
| `updated_by`    | `uuid`        | not null, references `users(id)`                                                         |
| `deleted_at`    | `timestamptz` | nullable (soft delete)                                                                   |

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

| Column                                                               | Type            | Notes                                                                     |
| -------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------- |
| `id`                                                                 | `uuid`          | PK, references `auth.users(id) on delete cascade`                         |
| `company_id`                                                         | `uuid`          | nullable on insert, set by admin after invite. References `companies(id)` |
| `email`                                                              | `text`          | not null. Mirrored from `auth.users.email`; updated by trigger if changed |
| `full_name`                                                          | `text`          | nullable                                                                  |
| `role`                                                               | `user_role`     | not null, default `'viewer'`                                              |
| `phone`                                                              | `text`          | nullable                                                                  |
| `is_active`                                                          | `boolean`       | not null, default `false`. Set true by admin after company assignment     |
| `created_at`, `created_by`, `updated_at`, `updated_by`, `deleted_at` | (audit pattern) | `created_by`/`updated_by` reference `users(id)`                           |

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

| Column                                                               | Type            | Notes                                                                      |
| -------------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------- |
| `id`                                                                 | `uuid`          | PK, default `gen_random_uuid()`                                            |
| `company_id`                                                         | `uuid`          | not null, references `companies(id)`                                       |
| `code`                                                               | `text`          | not null. Business key (e.g. `ITM-001`)                                    |
| `name`                                                               | `text`          | not null                                                                   |
| `description`                                                        | `text`          | nullable                                                                   |
| `drawing_no`                                                         | `text`          | nullable                                                                   |
| `revision`                                                           | `text`          | not null, default `'A'`                                                    |
| `material`                                                           | `text`          | nullable. Free text (e.g. `EN8`, `SS304`)                                  |
| `uom`                                                                | `uom`           | not null, default `'NOS'`                                                  |
| `item_type`                                                          | `item_type`     | not null, default `'component'`                                            |
| `hsn_code`                                                           | `text`          | nullable. India tax classification                                         |
| `drawing_file_path`                                                  | `text`          | nullable. Supabase Storage path; replaces legacy base64 `drawingData` blob |
| `created_at`, `created_by`, `updated_at`, `updated_by`, `deleted_at` | (audit pattern) |                                                                            |

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

| Column                     | Type            | Notes                                            |
| -------------------------- | --------------- | ------------------------------------------------ |
| `id`                       | `uuid`          | PK                                               |
| `company_id`               | `uuid`          | not null, FK → `companies(id)`                   |
| `code`                     | `text`          | not null. Business key (e.g. `L&T_1`)            |
| `name`                     | `text`          | not null                                         |
| `contact_person`           | `text`          | nullable. Legacy `contact` field                 |
| `email`                    | `text`          | nullable                                         |
| `phone`                    | `text`          | nullable. (Not in legacy schema; added forward.) |
| `gst_number`               | `text`          | nullable. Indian GSTIN                           |
| `address_line1`            | `text`          | nullable. Legacy `address` collapsed here        |
| `city`, `state`, `pincode` | `text`          | nullable                                         |
| `is_active`                | `boolean`       | not null, default `true`                         |
| audit + `deleted_at`       | (audit pattern) |                                                  |

Indexes: `unique (company_id, code) where deleted_at is null`, `(company_id) where deleted_at is null`.

### `vendors`

Supplier master. Replaces legacy `vendors` (3 records).

| Column                     | Type            | Notes                                                               |
| -------------------------- | --------------- | ------------------------------------------------------------------- |
| `id`                       | `uuid`          | PK                                                                  |
| `company_id`               | `uuid`          | not null, FK                                                        |
| `code`                     | `text`          | not null. Legacy `code` (e.g. `VND-001`)                            |
| `name`                     | `text`          | not null                                                            |
| `contact_person`           | `text`          | nullable. Legacy `contact`                                          |
| `email`                    | `text`          | nullable                                                            |
| `phone`                    | `text`          | nullable                                                            |
| `gst_number`               | `text`          | nullable. Legacy `gst`                                              |
| `address_line1`            | `text`          | nullable. Legacy `address`                                          |
| `city`, `state`, `pincode` | `text`          | nullable                                                            |
| `materials_supplied`       | `text`          | nullable. Legacy `materials` (free-form, e.g. `EN8, EN24, EN31`)    |
| `rating`                   | `text`          | nullable. Legacy `rating` (free `A`/`B`/`C` etc.)                   |
| `is_active`                | `boolean`       | not null, default `true`. Derived from legacy `status === 'Active'` |
| audit + `deleted_at`       | (audit pattern) |                                                                     |

Indexes: `unique (company_id, code) where deleted_at is null`, `(company_id) where deleted_at is null`.

### `machines`

Shop-floor equipment master. Replaces legacy `machines` (12 records).

| Column               | Type            | Notes                                                                               |
| -------------------- | --------------- | ----------------------------------------------------------------------------------- |
| `id`                 | `uuid`          | PK                                                                                  |
| `company_id`         | `uuid`          | not null, FK                                                                        |
| `code`               | `text`          | not null. Legacy `machineId` (e.g. `CNC-01`)                                        |
| `name`               | `text`          | not null. Legacy `name` (e.g. `DX-200 5A`)                                          |
| `machine_type`       | `text`          | nullable. Legacy `type` (often empty)                                               |
| `capacity_per_shift` | `integer`       | nullable. Legacy `capPerShift`                                                      |
| `shifts_per_day`     | `integer`       | not null, default `1`. Legacy `shifts`                                              |
| `status`             | `text`          | not null, default `'Idle'`. Legacy `status` (`Running`/`Idle`/`Down`/`Maintenance`) |
| audit + `deleted_at` | (audit pattern) |                                                                                     |

Indexes: `unique (company_id, code) where deleted_at is null`, `(company_id) where deleted_at is null`, `(company_id, status) where deleted_at is null` (for the live operations board, Phase 3+).

### `operators`

Shop-floor worker master. Replaces legacy `operators` (1 record).

| Column               | Type            | Notes                                                                                           |
| -------------------- | --------------- | ----------------------------------------------------------------------------------------------- |
| `id`                 | `uuid`          | PK                                                                                              |
| `company_id`         | `uuid`          | not null, FK                                                                                    |
| `code`               | `text`          | not null. Legacy `opId` (e.g. `VNM`)                                                            |
| `name`               | `text`          | not null                                                                                        |
| `department`         | `text`          | nullable                                                                                        |
| `skills`             | `text`          | nullable. Free-form (e.g. `CNC, Welding`); junction table only if it earns its keep             |
| `is_active`          | `boolean`       | not null, default `true`                                                                        |
| `user_id`            | `uuid`          | **nullable**, FK → `users(id)`. Set when an operator also has a login; null for shop-floor-only |
| audit + `deleted_at` | (audit pattern) |                                                                                                 |

Indexes: `unique (company_id, code) where deleted_at is null`, `(company_id) where deleted_at is null`, `(user_id) where deleted_at is null` (for finding operators by their login).

---

## Phase 3 Tables — Op Entry Chain (T-024a draft, awaiting approval)

> **Status:** design draft from T-024a. No code generated yet. Decisions surfaced inline below for explicit user sign-off; once approved, recorded as ADR-011 and implemented in T-024b.

Replaces legacy collections: `routeCards` (14), `jobCards` (3), `jcOps` (20), `opLog` (81), `runningOps` (2). Total source: 120 records (104 op-chain + 14 + 2 derived).

Spec source: `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html`. Key references quoted below: `calcEngine()` at lines 1626–1731, op-entry submit at 5410–5490, machine op entry at 5668–5734, route-card lookup at 5966 / 6881–6935.

### Phase 3 Design Decisions (for user approval)

Each numbered point below is a binding decision the rest of this section depends on. Override individually before approval.

1. **`routeCards` → separate `route_cards` master + `route_card_ops` children + `route_card_revisions` (jsonb history).** Legacy looks up route by `itemCode`, copies ops to `jcOps` at JC creation (line 5966, 6881). Master template lifecycle is independent of jobs and already has `revision`/`revisionLog[]` semantics — split, don't denormalise. Snapshots in `route_card_revisions` use `jsonb` because they are archival point-in-time copies, never queried by structure (the JSON-blob anti-pattern only applies to live data).
2. **JC and JC-op statuses are NOT stored — they are computed via SQL views (`v_jc_op_status`, `v_jc_status`) mirroring `calcEngine()`.** Legacy never stored these (line 1718–1728 derives `jcStatus` from `jobCards.map(...)`). At our current scale (104 op rows × N reads/sec) the view cost is free; we get correctness-by-derivation, no cache invalidation, and Realtime subs to the underlying tables propagate automatically. Promote to materialized view in Phase 7 only if a report measurement says so.
3. **`runningOps` → real table `running_ops`, NOT a view.** It captures sessions that stop without completing (line 5703 sets `status='Stopped'`), holds session metadata (start time, operator, shift) that op_log alone can't reconstruct, and acts as the lock holder for the "machine runs one op at a time" rule (line 5526). Two partial unique indexes enforce the rules at DB level: `(company_id, jc_op_id) where status='running'` and `(machine_id) where status='running'`.
4. **`op_log` is a flat append-only table with a `type` enum (`start | complete | qc`).** Legacy `type` values seen: `'start'` (qty=0 with startTime), `'qc'` (qty=accepted, rejectQty=rejected), and `undefined`/`'complete'` (production — JC-wise form leaves it null at line 5426; Machine form sets `'complete'` at line 5679). Normalise: missing `type` → `'complete'` during transform.
5. **SO/JW link on `job_cards` → two nullable FK columns (`source_so_line_id`, `source_jw_id`) with FKs DEFERRED until Phase 4** when those tables exist. For now: `source_legacy_ref text` captures the legacy `(soNo, soRefId, soLineNo)` blob. Phase 4 backfills FKs and adds a `check (num_nonnulls(source_so_line_id, source_jw_id) = 1)` constraint.
6. **Outsource fields kept inline on `jc_ops`** (matches legacy structure, matches small-data reality). Normalisation into proper `osp_jobs` is deferred to Phase 8 (`outsourceJobs` collection migration). `outsource_vendor_id` is the only FK; PR/PO/DC numbers stay as text refs until those modules ship.
7. **Realtime selectivity (ADR-004):** `op_log` and `running_ops` are the hot tables. Both carry `(company_id, jc_op_id)` natively, supporting Postgres Realtime row filters out of the box.
8. **Operator on `op_log` → both FK and free-text fallback.** Legacy stores free-text name (`'Suresh P.'`, `'Vinay'`, `''`, `'Operator'`); some entries don't match any operator master. Add `operator_id uuid nullable references operators(id)` (best-effort transform match by name) plus `operator_name text` (always preserved). Service layer prefers the FK; falls back to text.
9. **Drawing data on `job_cards` → Storage path only**, mirroring `items.drawing_file_path`. Legacy `drawingData` base64 blob is dropped; `drawingFile` filename → `drawing_file_path`. All 3 source records have empty values, so no migration cost.
10. **`qcDocs[]` on `job_cards` is deferred to Phase 6 (QC module).** All 3 source records are empty.
11. **Orphan `op_log` rows** (7 rows pointing at `JC-MS-002`/`003`/`004` which don't exist in `jobCards`) are captured as anomalies and NOT loaded. Same pattern as Phase 2 `_anomalies.json`.

### Phase 3 Enums

```sql
create type op_type           as enum ('process', 'qc', 'outsource');
create type op_log_type       as enum ('start', 'complete', 'qc');
create type outsource_status  as enum ('pending', 'pr_raised', 'po_created', 'sent', 'received');
create type running_op_status as enum ('running', 'done', 'stopped');
create type shift             as enum ('day', 'night');
create type jc_priority       as enum ('normal', 'high');  -- legacy form line 5982 only exposes Normal/High
```

(Lowercase enum values; transform normalises legacy mixed-case to lowercase.)

### `route_cards`

Master template defining the operation sequence for a manufactured item. Looked up by `item_id` at JC creation; ops are copied to `jc_ops` (snapshot semantics).

| Column               | Type            | Notes                                                          |
| -------------------- | --------------- | -------------------------------------------------------------- |
| `id`                 | `uuid`          | PK                                                             |
| `company_id`         | `uuid`          | not null, FK                                                   |
| `code`               | `text`          | not null. Business key (legacy `rcNo`, e.g. `IN-RC-00001`)     |
| `item_id`            | `uuid`          | not null, FK → `items(id)`. Legacy `itemCode`                  |
| `current_revision`   | `integer`       | not null, default `1`. Bumped by service layer when ops mutate |
| `notes`              | `text`          | nullable                                                       |
| audit + `deleted_at` | (audit pattern) |                                                                |

Indexes:

- `unique (company_id, code) where deleted_at is null`
- `unique (company_id, item_id) where deleted_at is null` — one active route card per item per company (matches legacy `find(r=>r.itemCode===itemCode)` lookup pattern at line 6925)
- `(item_id) where deleted_at is null`

RLS: `route_cards_company_read` (any role, same company) + `route_cards_manager_write` (admin/manager only).

### `route_card_ops`

Live ops for the current revision of a route card. Editable. Copied to `jc_ops` at JC creation.

| Column                 | Type            | Notes                                                                                                                                  |
| ---------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                   | `uuid`          | PK                                                                                                                                     |
| `company_id`           | `uuid`          | not null, FK                                                                                                                           |
| `route_card_id`        | `uuid`          | not null, FK → `route_cards(id) on delete cascade`                                                                                     |
| `op_seq`               | `integer`       | not null. 1-indexed sequence within route                                                                                              |
| `machine_id`           | `uuid`          | nullable, FK → `machines(id)`. Null for OSP-only steps (legacy `machineId: ""`)                                                        |
| `machine_code_text`    | `text`          | nullable. Preserves legacy `'QC'` sentinel and other free-text values that don't FK-resolve                                            |
| `operation`            | `text`          | not null. Free-text op label (e.g. `'od turn'`, `'DIR'`, `'COATING'`)                                                                  |
| `op_type`              | `op_type`       | not null, default `'process'`                                                                                                          |
| `cycle_time_min`       | `numeric(10,2)` | not null, default `0`. **Legacy stores HOURS here** (column name carry-over; UI labels read "Cycle (hrs)"). See ISSUE-011.             |
| `program`              | `text`          | nullable                                                                                                                               |
| `tool_no`              | `text`          | nullable                                                                                                                               |
| `tool_details`         | `text`          | nullable                                                                                                                               |
| `qc_required`          | `boolean`       | not null, default `false`                                                                                                              |
| `osp_vendor_id`        | `uuid`          | nullable, FK → `vendors(id) on delete set null`. Live vendor when `op_type='outsource'`. **Added in `0022_phase8_route_card_osp.sql`** |
| `osp_vendor_code_text` | `text`          | nullable. Free-text vendor code fallback (ADR-012 #10 pattern) when the legacy `ospVendorCode` doesn't resolve to a master row         |
| `osp_lead_days`        | `integer`       | nullable. Lead days for the outside process; legacy default 5                                                                          |
| audit + `deleted_at`   | (audit pattern) |                                                                                                                                        |

Indexes:

- `unique (route_card_id, op_seq) where deleted_at is null`
- `(machine_id) where deleted_at is null`
- `(osp_vendor_id) where osp_vendor_id is not null`

RLS: same pattern as parent.

### `route_card_revisions`

Append-only history of past route card revisions. Snapshot held as `jsonb` (archival, not queried by shape).

| Column          | Type          | Notes                                                 |
| --------------- | ------------- | ----------------------------------------------------- |
| `id`            | `uuid`        | PK                                                    |
| `company_id`    | `uuid`        | not null, FK                                          |
| `route_card_id` | `uuid`        | not null, FK → `route_cards(id) on delete cascade`    |
| `revision_no`   | `integer`     | not null. 1-indexed                                   |
| `notes`         | `text`        | nullable. Legacy `notes` (e.g. `"Updated"`)           |
| `ops_snapshot`  | `jsonb`       | not null. Frozen array of ops at the time of revision |
| `created_at`    | `timestamptz` | not null, default `now()`                             |
| `created_by`    | `uuid`        | not null, FK → `users(id)`                            |

(No `updated_at`/`deleted_at` — revisions are immutable history.)

Indexes:

- `unique (route_card_id, revision_no)`
- `(route_card_id, created_at desc)` — for revision-history view

RLS: `route_card_revisions_company_read` (any role).

### `job_cards`

Production batch on the shop floor for a specific item and quantity. Header table.

| Column               | Type            | Notes                                                                                                                              |
| -------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `id`                 | `uuid`          | PK                                                                                                                                 |
| `company_id`         | `uuid`          | not null, FK                                                                                                                       |
| `code`               | `text`          | not null. Business key (legacy `jcNo`, e.g. `IN-JC-00001`)                                                                         |
| `jc_date`            | `date`          | not null. Legacy `date` (creation/issue date)                                                                                      |
| `item_id`            | `uuid`          | not null, FK → `items(id)`. Legacy `itemCode`                                                                                      |
| `order_qty`          | `integer`       | not null, check `> 0`                                                                                                              |
| `priority`           | `jc_priority`   | not null, default `'normal'`                                                                                                       |
| `due_date`           | `date`          | nullable                                                                                                                           |
| `drawing_file_path`  | `text`          | nullable. Storage path; replaces legacy base64 `drawingData`                                                                       |
| `source_so_line_id`  | `uuid`          | nullable. FK → `sales_order_lines(id)` **deferred to Phase 4**                                                                     |
| `source_jw_id`       | `uuid`          | nullable. FK → `job_work_orders(id)` **deferred to Phase 4**                                                                       |
| `source_legacy_ref`  | `text`          | nullable. Captures legacy `(soNo, soRefId, soLineNo, soPartName, clientPoLineNo)` as JSON-encoded text until Phase 4 backfills FKs |
| `closed_at`          | `timestamptz`   | nullable. Set when JC manually closed (legacy `'Closed'` status path)                                                              |
| audit + `deleted_at` | (audit pattern) |                                                                                                                                    |

Indexes:

- `unique (company_id, code) where deleted_at is null`
- `(company_id, item_id) where deleted_at is null`
- `(company_id, due_date) where deleted_at is null and closed_at is null` — overdue JC reports
- `(company_id, jc_date) where deleted_at is null`

RLS: `job_cards_company_read` (any role) + `job_cards_manager_write` (admin/manager only — operators cannot create JCs, they only log against existing ones).

**No status column** — derived via `v_jc_status` view (decision #2). The view projects: `total_ops`, `done_ops`, `qc_pending_ops`, `status` (`no_ops` | `open` | `qc_pending` | `complete` | `closed`).

### `jc_ops`

Per-step routing of a job card. Snapshot copied from `route_card_ops` at JC creation; thereafter independent.

| Column                   | Type               | Notes                                                                                                                                                                                                        |
| ------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                     | `uuid`             | PK                                                                                                                                                                                                           |
| `company_id`             | `uuid`             | not null, FK                                                                                                                                                                                                 |
| `job_card_id`            | `uuid`             | not null, FK → `job_cards(id) on delete cascade`                                                                                                                                                             |
| `op_seq`                 | `integer`          | not null. 1-indexed within JC                                                                                                                                                                                |
| `machine_id`             | `uuid`             | nullable, FK → `machines(id)`                                                                                                                                                                                |
| `machine_code_text`      | `text`             | nullable. Preserves legacy `'QC'` and other unresolvable strings                                                                                                                                             |
| `operation`              | `text`             | not null                                                                                                                                                                                                     |
| `op_type`                | `op_type`          | not null, default `'process'`                                                                                                                                                                                |
| `cycle_time_min`         | `numeric(10,2)`    | not null, default `0`                                                                                                                                                                                        |
| `program`                | `text`             | nullable                                                                                                                                                                                                     |
| `tool_no`                | `text`             | nullable                                                                                                                                                                                                     |
| `tool_details`           | `text`             | nullable                                                                                                                                                                                                     |
| `qc_required`            | `boolean`          | not null, default `false`                                                                                                                                                                                    |
| `qc_call_date`           | `date`             | nullable. Auto-set when prior op completes (legacy line 5476)                                                                                                                                                |
| `qc_attended_date`       | `date`             | nullable                                                                                                                                                                                                     |
| `rework_qty`             | `integer`          | not null, default `0`. Counter, decremented by op-log entries (legacy line 5462)                                                                                                                             |
| `outsource_vendor_id`    | `uuid`             | nullable, FK → `vendors(id)`. Legacy `outsourceVendor` text resolved to FK; null if unresolvable                                                                                                             |
| `outsource_vendor_text`  | `text`             | nullable. Fallback for unresolvable legacy vendor codes                                                                                                                                                      |
| `outsource_cost`         | `numeric(12,2)`    | not null, default `0`                                                                                                                                                                                        |
| `outsource_status`       | `outsource_status` | nullable. Null for non-outsource ops; default `'pending'` when `op_type='outsource'`                                                                                                                         |
| `outsource_pr_id`        | `uuid`             | nullable, FK → `purchase_requests(id) on delete set null`. Phase 5 FK upgrade (ADR-015 #5); supersedes legacy text `outsource_pr_no` (dropped by `0014_phase5_jc_ops_drop_legacy.sql` after T-035c backfill) |
| `outsource_po_line_id`   | `uuid`             | nullable, FK → `purchase_order_lines(id) on delete set null`. Phase 5 FK upgrade; supersedes legacy text `outsource_po_no`                                                                                   |
| `outsource_dc_no`        | `text`             | nullable                                                                                                                                                                                                     |
| `outsource_sent_qty`     | `integer`          | not null, default `0`                                                                                                                                                                                        |
| `outsource_sent_date`    | `date`             | nullable                                                                                                                                                                                                     |
| `outsource_returned_qty` | `integer`          | not null, default `0`                                                                                                                                                                                        |
| audit + `deleted_at`     | (audit pattern)    |                                                                                                                                                                                                              |

Indexes:

- `unique (job_card_id, op_seq) where deleted_at is null`
- `(machine_id) where deleted_at is null`
- `(company_id, op_type) where deleted_at is null` — for outsource queue / QC dashboard filters
- `(outsource_vendor_id) where deleted_at is null and op_type = 'outsource'`
- `(outsource_pr_id) where outsource_pr_id is not null` — Phase 5 FK
- `(outsource_po_line_id) where outsource_po_line_id is not null` — Phase 5 FK

RLS: `jc_ops_company_read` (any role) + `jc_ops_manager_write` (admin/manager — operators don't edit op definitions, only log against them).

**No completed/accepted/rejected qty columns** — derived from `op_log` via `v_jc_op_status` view (decision #2).

### `op_log`

Append-only log of work events against a `jc_op`. Hot table — Realtime row-filterable.

| Column          | Type          | Notes                                                                                                                      |
| --------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `id`            | `uuid`        | PK                                                                                                                         |
| `company_id`    | `uuid`        | not null, FK                                                                                                               |
| `jc_op_id`      | `uuid`        | not null, FK → `jc_ops(id) on delete cascade`                                                                              |
| `log_no`        | `text`        | not null. Legacy `logNo` (e.g. `LOG-022`); NOT unique — legacy generates duplicates (e.g. LOG-008 appears twice in source) |
| `log_type`      | `op_log_type` | not null. `'start'` (qty=0, has start_time), `'complete'` (production), `'qc'` (qty=accepted, reject_qty=rejected)         |
| `log_date`      | `date`        | not null                                                                                                                   |
| `shift`         | `shift`       | not null                                                                                                                   |
| `qty`           | `integer`     | not null, default `0`, check `>= 0`. For `'qc'` type: accepted qty                                                         |
| `reject_qty`    | `integer`     | not null, default `0`, check `>= 0`. For `'qc'` type: rejected qty; for `'complete'`: rejected during production           |
| `operator_id`   | `uuid`        | nullable, FK → `operators(id)`. Best-effort name match during transform                                                    |
| `operator_name` | `text`        | nullable. Preserved from legacy free-text                                                                                  |
| `start_time`    | `time`        | nullable. Set only when `log_type='start'` (HH:MM in legacy)                                                               |
| `remarks`       | `text`        | nullable                                                                                                                   |
| `created_at`    | `timestamptz` | not null, default `now()`                                                                                                  |
| `created_by`    | `uuid`        | not null, FK → `users(id)`                                                                                                 |

(No `updated_at`/`updated_by`/`deleted_at` — log entries are immutable. Corrections happen by appending a reversing entry, not by editing.)

Indexes:

- `(company_id, jc_op_id, log_date)` — primary read pattern (Realtime filter + history queries)
- `(company_id, log_date) where log_type = 'complete'` — daily production reports
- `(operator_id, log_date) where operator_id is not null` — operator productivity reports

RLS:

- `op_log_company_read` (any role)
- `op_log_operator_insert` — operators can insert ONLY where `created_by = current_user_id() and log_type in ('start', 'complete')` (no QC entries from shop floor)
- `op_log_qc_insert` — `qc` role can insert with `log_type = 'qc'`
- No update/delete policies — table is append-only by RLS as well as by convention

API write paths (T-040d, 2026-05-15):

- `log_type='start'` ← `POST /op-entry/start` (also creates a `running_ops` row)
- `log_type='complete'` ← `POST /op-entry/op-log` (production complete; rejects `op_type='qc'` ops per ISSUE-001 fix)
- `log_type='qc'` ← `POST /op-entry/qc-log` (QC inspection; only valid against qc-bearing ops, sets `jc_ops.qc_attended_date` + backfills `qc_call_date` if null, fires SO/JW close cascade)

Realtime: enable on this table; client subscribes filtered by `(company_id = X and jc_op_id = Y)` for the Op Entry screen.

### `running_ops`

Live session record. One row per (jc_op, attempt). Closed by setting `status = 'done'` (totalDone >= orderQty, line 5436) or `'stopped'` (manual stop, line 5703).

| Column                                                         | Type                             | Notes                                                                               |
| -------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------- |
| `id`                                                           | `uuid`                           | PK                                                                                  |
| `company_id`                                                   | `uuid`                           | not null, FK                                                                        |
| `jc_op_id`                                                     | `uuid`                           | not null, FK → `jc_ops(id) on delete cascade`                                       |
| `machine_id`                                                   | `uuid`                           | nullable, FK → `machines(id)`. Null for OSP sessions (legacy uses `'OSP'` sentinel) |
| `is_osp`                                                       | `boolean`                        | not null, default `false`. Legacy `isOSP` flag                                      |
| `operator_id`                                                  | `uuid`                           | nullable, FK → `operators(id)`                                                      |
| `operator_name`                                                | `text`                           | nullable. Free-text fallback                                                        |
| `start_date`                                                   | `date`                           | not null                                                                            |
| `start_time`                                                   | `time`                           | not null                                                                            |
| `shift`                                                        | `shift`                          | not null                                                                            |
| `status`                                                       | `running_op_status`              | not null, default `'running'`                                                       |
| `ended_at`                                                     | `timestamptz`                    | nullable. Set when status transitions to `done` or `stopped`                        |
| audit (`created_at`, `created_by`, `updated_at`, `updated_by`) | (audit pattern, no `deleted_at`) |                                                                                     |

Indexes:

- `unique (company_id, jc_op_id) where status = 'running'` — enforces "only one running session per op" (legacy line 5523)
- `unique (machine_id) where status = 'running' and is_osp = false` — enforces "machine runs one op at a time" (legacy line 5526)
- `(company_id, status, start_date desc)` — Live Operations Board

RLS:

- `running_ops_company_read` (any role)
- `running_ops_operator_write` — operators insert/update where `created_by = current_user_id()`
- `running_ops_manager_write` — admin/manager can update any row (e.g. force-stop)

Realtime: enable; client subscribes filtered by `(company_id = X)` for the Live Operations Board.

### Phase 3 Views (specified now, SQL written in T-024b)

`v_jc_op_status` — projects from `jc_ops + op_log + running_ops` the columns: `jc_op_id, completed_qty, qc_accepted_qty, qc_rejected_qty, input_avail, available, qc_pending, computed_status` where `computed_status` is one of `waiting | available | in_progress | running | qc_pending | complete | pr_raised | po_created | at_vendor | received | ready_for_pr | outsource`. Mirrors `calcEngine().enrichedOps` (legacy line 1657–1701).

`v_jc_status` — projects from `job_cards + v_jc_op_status` the columns: `job_card_id, total_ops, done_ops, qc_pending_ops, computed_status` where `computed_status` is one of `no_ops | open | qc_pending | complete | closed`. Mirrors `calcEngine().jcStatus` (legacy line 1718–1728). `closed` triggers when `closed_at is not null`.

`v_machine_load` — Phase 7 candidate, NOT included in T-024b. Mirrors `calcEngine().machineLoad`.

### Phase 3 Triggers

- `before update` on each of `route_cards`, `route_card_ops`, `job_cards`, `jc_ops`, `running_ops` → `set_updated_at()` (existing helper from Phase 1).
- (No status-maintenance triggers — statuses are view-derived per decision #2.)
- (Server-side validations like "qty cannot exceed planned" land in T-026 service layer, not as DB triggers — Drizzle services are the testable business-logic layer per CLAUDE.md §6.2.)

---

## Phase 4 Tables — Sales Chain (T-029a draft, awaiting approval)

> **Status:** design draft from T-029a. No code generated yet. Decisions surfaced inline below for explicit user sign-off; once approved, recorded as ADR-012 and implemented in T-029b.

Replaces legacy collections: `salesOrders` (9 records — 1 demo Equipment SO + 8 lines of SO-436), `jobWorkOrders` (2 records — JW-001, JW-002 each with 1 line). Plus the deferred FK backfill on `job_cards` from ADR-011 #5.

Spec source: `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html`. Key references: SO/JW seed data lines 1425–1432, `_autoCloseSO()` line 1355–1369, `checkSoAutoClose()` line 5368–5396, status filters line 19308–19310, dispatched/closed/completed grouping line 19542.

### Phase 4 Design Decisions (for user approval)

Eleven binding sub-decisions; the most consequential first.

1. **Both `salesOrders` and `jobWorkOrders` get header + lines normalisation.** Legacy stores each LINE as a separate doc with header fields repeated (8 of 9 SO docs share `soNo='SO-436'`; both JW docs are single-line). Postgres: `sales_orders` (header) + `sales_order_lines` (children); `job_work_orders` (header) + `job_work_order_lines` (children). Symmetry simplifies the SO/JW link on `job_cards` (always `*_line_id`) and matches the legacy mental model where each LINE is a separately-tracked unit.

2. **Rename `job_cards.source_jw_id` → `job_cards.source_jw_line_id`** for symmetry with `source_so_line_id`. Legacy `jcRef.soRefId` always points to the per-line doc (line 5371); the line is the JC's actual source. Safe rename — the column is null in all current rows (T-024c didn't backfill).

3. **Backfill `job_cards.source_so_line_id` and `source_jw_line_id` from `source_legacy_ref` text.** The 2 surviving migrated JCs (IN-JC-00002, IN-JC-00003) both reference SO-436 lines via legacy `soRefId` (`4n7tmo9u`, `mmrfp7d3`). Backfill resolves these via the new `_id_map.json` (Phase 4 sales_order_lines entries by legacy id). After verification, **keep `source_legacy_ref` for one phase as audit trail; drop in Phase 5 cleanup commit.**

4. **Add `check (num_nonnulls(source_so_line_id, source_jw_line_id) <= 1)` on `job_cards`.** ADR-011 #5 originally said `= 1` (every JC has a source). Relaxed to `<= 1` to allow source-less JCs going forward (e.g. internal stock builds). All current data is `= 1`.

5. **`so_status` enum: `open | closed | dispatched | cancelled`.** Locked from `_autoCloseSO()` line 1367 (`'Closed'`), filter line 19308–19310 (`'Open'`, `'Completed'` is treated as alias of Closed in filter; we collapse to one), dispatch line 19542 (`'Dispatched'`). **Drop `'Completed'` and `'Hold'` — neither is set by legacy code on actual SOs/JWs.** Both SO and JW use this enum (status semantics are identical).

6. **`so_type` enum: `component_manufacturing | equipment | with_material`.** Three values seen in data + legacy seed. **Drop `'Job Work'`** — JWs are a separate table, not a type variant of SO. Equipment SOs (1 of 9 records) have a `bom_master_id` for BOM expansion; the other 8 are line-level orders.

7. **`bomMasters` collection deferred.** Equipment SOs reference a BOM master that expands into multiple JCs. Out of scope for Phase 4 (1 record exposed, complex expansion logic). Store `bom_master_id text` and `bom_status text` on `sales_orders` header as forward fields. When BOM module ships (later phase), those become FK references.

8. **`milestones[]` deferred.** All migrated records have empty arrays. Capture in `_legacyExtras` only; later phase adds `sales_order_milestones` table when needed.

9. **`customer_name text` fallback alongside `client_id` FK.** The demo Equipment SO has no `clientId` (just `customer: 'Demo Customer Pvt Ltd'`). Same pattern as Phase 3's operator FK + name fallback (ADR-011 #8). Service layer prefers `client_id`; falls back to `customer_name` for display.

10. **`item_code_text` fallback on lines alongside `item_id` FK.** Same pattern. Lines whose `itemCode` doesn't resolve to the items master (the ITM-001 cascade risk) get loaded with `item_id=null` and the original `itemCode` preserved in `item_code_text`. Service-layer rendering shows whichever is present.

11. **`gst_percent` is header-level on `sales_orders`** (matches legacy data — same value across all lines of SO-436). If a future SO has per-line GST, we promote to lines; current data doesn't need it.

### Phase 4 Enums

```sql
create type so_type   as enum ('component_manufacturing', 'equipment', 'with_material');
create type so_status as enum ('open', 'closed', 'dispatched', 'cancelled');
```

(Lowercase values; transform normalises legacy mixed-case to lowercase. `so_status` shared between SO and JW since semantics are identical.)

### `sales_orders`

Header table for sales orders. Each header has 1+ lines.

| Column               | Type            | Notes                                                                      |
| -------------------- | --------------- | -------------------------------------------------------------------------- |
| `id`                 | `uuid`          | PK                                                                         |
| `company_id`         | `uuid`          | not null, FK                                                               |
| `code`               | `text`          | not null. Business key (legacy `soNo`, e.g. `SO-436`)                      |
| `so_date`            | `date`          | not null                                                                   |
| `client_id`          | `uuid`          | nullable, FK → `clients(id)`. Resolved from legacy `clientId`/`clientCode` |
| `customer_name`      | `text`          | nullable. Free-text fallback (used when `client_id` is null)               |
| `client_po_no`       | `text`          | nullable. Header-level PO ref (legacy `clientPoNo` on the SO header)       |
| `type`               | `so_type`       | not null                                                                   |
| `status`             | `so_status`     | not null, default `'open'`                                                 |
| `gst_percent`        | `numeric(5,2)`  | not null, default `18.00`                                                  |
| `bom_master_id`      | `text`          | nullable. Forward ref to BOM master (deferred to a later phase as FK)      |
| `bom_status`         | `text`          | nullable. Equipment SOs only (e.g. `'BOM Pending'`)                        |
| `cost_center`        | `text`          | nullable                                                                   |
| `remarks`            | `text`          | nullable                                                                   |
| audit + `deleted_at` | (audit pattern) |                                                                            |

Indexes:

- `unique (company_id, code) where deleted_at is null`
- `(company_id, client_id) where deleted_at is null`
- `(company_id, status) where deleted_at is null`
- `(company_id, so_date desc) where deleted_at is null`

RLS: `sales_orders_company_read` (any role) + `sales_orders_manager_write` (admin/manager only — sales team has manager role).

### `sales_order_lines`

Per-line items on a sales order.

| Column               | Type            | Notes                                                                           |
| -------------------- | --------------- | ------------------------------------------------------------------------------- |
| `id`                 | `uuid`          | PK                                                                              |
| `company_id`         | `uuid`          | not null, FK                                                                    |
| `sales_order_id`     | `uuid`          | not null, FK → `sales_orders(id) on delete cascade`                             |
| `line_no`            | `integer`       | not null                                                                        |
| `item_id`            | `uuid`          | nullable, FK → `items(id)`                                                      |
| `item_code_text`     | `text`          | nullable. Preserves legacy `itemCode` when item_id can't resolve                |
| `part_name`          | `text`          | not null. Legacy `partName`                                                     |
| `material`           | `text`          | nullable                                                                        |
| `drawing_no`         | `text`          | nullable                                                                        |
| `uom`                | `uom`           | not null, default `'NOS'`                                                       |
| `order_qty`          | `integer`       | not null, check `> 0`                                                           |
| `rate`               | `numeric(12,2)` | not null, default `0`                                                           |
| `due_date`           | `date`          | nullable                                                                        |
| `client_po_line_no`  | `text`          | nullable                                                                        |
| `status`             | `so_status`     | not null, default `'open'`. Per-line status (auto-closed when JCs satisfy line) |
| audit + `deleted_at` | (audit pattern) |                                                                                 |

Indexes:

- `unique (sales_order_id, line_no) where deleted_at is null`
- `(item_id) where deleted_at is null`
- `(company_id, status) where deleted_at is null`

RLS: same pattern as parent.

### `job_work_orders`

Header table for outsourced job work — customer supplies raw material, we manufacture.

| Column               | Type            | Notes                                                                                               |
| -------------------- | --------------- | --------------------------------------------------------------------------------------------------- |
| `id`                 | `uuid`          | PK                                                                                                  |
| `company_id`         | `uuid`          | not null, FK                                                                                        |
| `code`               | `text`          | not null. Business key (legacy `jwNo`, e.g. `JW-001`)                                               |
| `jw_date`            | `date`          | not null                                                                                            |
| `client_id`          | `uuid`          | nullable, FK → `clients(id)`. Both current JWs have empty `clientId` — load null, use customer_name |
| `customer_name`      | `text`          | nullable. Fallback                                                                                  |
| `client_po_no`       | `text`          | nullable                                                                                            |
| `status`             | `so_status`     | not null, default `'open'`                                                                          |
| `remarks`            | `text`          | nullable                                                                                            |
| audit + `deleted_at` | (audit pattern) |                                                                                                     |

Indexes:

- `unique (company_id, code) where deleted_at is null`
- `(company_id, client_id) where deleted_at is null`
- `(company_id, status) where deleted_at is null`

RLS: same pattern as `sales_orders`.

### `job_work_order_lines`

| Column                   | Type            | Notes                                                                    |
| ------------------------ | --------------- | ------------------------------------------------------------------------ |
| `id`                     | `uuid`          | PK                                                                       |
| `company_id`             | `uuid`          | not null, FK                                                             |
| `job_work_order_id`      | `uuid`          | not null, FK → `job_work_orders(id) on delete cascade`                   |
| `line_no`                | `integer`       | not null                                                                 |
| `item_id`                | `uuid`          | nullable, FK → `items(id)`                                               |
| `item_code_text`         | `text`          | nullable. Same fallback pattern as SO lines                              |
| `part_name`              | `text`          | not null                                                                 |
| `material`               | `text`          | nullable                                                                 |
| `drawing_no`             | `text`          | nullable                                                                 |
| `uom`                    | `uom`           | not null, default `'NOS'`                                                |
| `order_qty`              | `integer`       | not null, check `> 0`                                                    |
| `due_date`               | `date`          | nullable                                                                 |
| `client_material`        | `text`          | nullable. Raw material spec from client (e.g. `'SS 304 Round Bar 80mm'`) |
| `client_material_qty`    | `numeric(12,2)` | nullable                                                                 |
| `material_received_date` | `date`          | nullable                                                                 |
| `material_received_qty`  | `numeric(12,2)` | nullable                                                                 |
| `status`                 | `so_status`     | not null, default `'open'`                                               |
| audit + `deleted_at`     | (audit pattern) |                                                                          |

Indexes:

- `unique (job_work_order_id, line_no) where deleted_at is null`
- `(item_id) where deleted_at is null`

RLS: same pattern as parent.

### `job_cards` — Phase 4 ALTERS

Three changes, applied as a single Drizzle-generated migration:

1. **Rename column** `source_jw_id` → `source_jw_line_id` (decision #2).
2. **Add FK constraints:** `source_so_line_id` → `sales_order_lines(id)`, `source_jw_line_id` → `job_work_order_lines(id)`. Both nullable; FK is enforced when set.
3. **Add CHECK** `num_nonnulls(source_so_line_id, source_jw_line_id) <= 1` (decision #4).

Pre-migration data state: both surviving job_cards (IN-JC-00002, IN-JC-00003) currently have NULL FKs and a populated `source_legacy_ref`. Backfill SQL runs in the same migration (`UPDATE job_cards SET source_so_line_id = (SELECT id FROM sales_order_lines WHERE legacy_id = (source_legacy_ref::jsonb->>'soRefId') ...)`). The lookup uses the `_id_map.json` produced by Phase 4 transforms.

Wait — `legacy_id` isn't a column on `sales_order_lines`. Backfill happens via the migration LOADER, not in SQL: Phase 4 load script reads `_id_map.json`, fetches each job_card's `source_legacy_ref`, looks up the new UUID, issues an UPDATE. Cleaner than embedding the mapping in migration SQL.

### Phase 4 Triggers

`before update` on each new table → `set_updated_at()`. No status-maintenance triggers — auto-close cascade lives in the service layer (T-033) where it's testable.

### Phase 4 Views (deferred to T-033 unless a measurement says otherwise)

`v_so_status` — projects per-SO summary (total lines, closed lines, dispatched lines, etc.) for the SO list/detail screens. Will be useful for UI but not required for T-029b storage layer. Defer to T-030 when the UI needs it.

---

## Phase 5 Tables — Procurement (T-035a draft, awaiting approval)

> **Status:** design draft from T-035a. Approved by user; ADR-015 captures the decisions. Implementation in T-035b.

Replaces legacy collections: `purchaseRequests` (1 record — `PR-00001`), `purchaseOrders` (1 record — `IN-JWPO-00001`, single line), `grn` (3 records under one `IN-GRN-00001` header), `storeTransactions` (2 records — both `IN` from GRN QC). Plus the deferred FK upgrade on `jc_ops` from ADR-011 #6 (text outsource_pr_no / outsource_po_no → real FKs).

Spec source: `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html`. Key references: `_getPoBaseData()` line 25717, `addPO()` line 25728, `renderGRN()` line 26444, `addGRN()` line 26515, status filters at lines 2815-2817 + 3806, store-transaction inserts at lines 3933-3934 + 5449-5450.

### Phase 5 Enums

```sql
create type po_status       as enum ('draft', 'open', 'partial', 'qc_pending', 'closed', 'cancelled');
create type pr_status       as enum ('open', 'approved', 'po_created', 'cancelled');
create type po_type         as enum ('standard', 'job_work', 'outsource', 'service');
create type grn_qc_status   as enum ('pending', 'in_progress', 'completed');
create type store_txn_type  as enum ('in', 'out', 'adjust');
create type store_txn_source_type as enum ('grn_qc', 'manual_adjust', 'dispatch', 'jw_in', 'jw_out', 'other', 'qc_accept');
-- 'qc_accept' added 2026-05-15 via migration 0017 (T-040f) — production QC accept on the LAST op of a JC.
```

### `purchase_requests`

Bridges plan / op-entry → PO. Single-table (no separate lines) since current data is single-line per PR; promote to header+lines if multi-line PRs become a real workflow.

| Column               | Type            | Notes                                                                                                                              |
| -------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `id`                 | `uuid`          | PK                                                                                                                                 |
| `company_id`         | `uuid`          | not null, FK                                                                                                                       |
| `code`               | `text`          | not null. Business key (legacy `prNo`, e.g. `PR-00001`)                                                                            |
| `pr_date`            | `date`          | not null                                                                                                                           |
| `status`             | `pr_status`     | not null, default `'open'`                                                                                                         |
| `vendor_id`          | `uuid`          | nullable, FK → `vendors(id)`                                                                                                       |
| `vendor_code_text`   | `text`          | nullable. Free-text fallback when `vendor_id` can't resolve (ADR-012 #10 pattern). Legacy data uses `vendorCode='VND-001'` strings |
| `item_id`            | `uuid`          | nullable, FK → `items(id)`                                                                                                         |
| `item_code_text`     | `text`          | nullable. Same fallback pattern                                                                                                    |
| `item_name`          | `text`          | nullable. Snapshot at PR creation                                                                                                  |
| `qty`                | `integer`       | not null, check `> 0`                                                                                                              |
| `est_cost`           | `numeric(12,2)` | not null, default `0`                                                                                                              |
| `required_date`      | `date`          | nullable                                                                                                                           |
| `source_jc_op_id`    | `uuid`          | nullable, FK → `jc_ops(id) on delete set null`. Set when PR raised from outsource workflow                                         |
| `source_so_line_id`  | `uuid`          | nullable, FK → `sales_order_lines(id) on delete set null`. Forward link for cost rollup; legacy carries `soRefId` on PR            |
| `operation`          | `text`          | nullable. Snapshot for outsource PRs (legacy `operation='COATING'`)                                                                |
| `remarks`            | `text`          | nullable                                                                                                                           |
| `approved_by`        | `uuid`          | nullable, FK → `users(id)`. Null until status=approved                                                                             |
| `approved_at`        | `timestamptz`   | nullable                                                                                                                           |
| `po_id`              | `uuid`          | nullable, FK → `purchase_orders(id) on delete set null`. Set when PO is generated from PR (legacy `prNo` → `poNo` link)            |
| `po_created_at`      | `timestamptz`   | nullable                                                                                                                           |
| audit + `deleted_at` | (audit pattern) |                                                                                                                                    |

Indexes:

- `unique (company_id, code) where deleted_at is null`
- `(company_id, status) where deleted_at is null`
- `(company_id, vendor_id) where deleted_at is null`
- `(source_jc_op_id) where source_jc_op_id is not null and deleted_at is null`

CHECK: `num_nonnulls(vendor_id, vendor_code_text) >= 1` — every PR must reference a vendor somehow.
CHECK: `num_nonnulls(item_id, item_code_text) >= 1` — every PR has an item ref.

RLS: `purchase_requests_company_read` (any role) + `purchase_requests_manager_write` (admin/manager).

### `purchase_orders`

Header table for purchase orders. Each header has 1+ lines (current data: 1 PO, 1 line — but design supports many).

| Column               | Type            | Notes                                                                                                                   |
| -------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `id`                 | `uuid`          | PK                                                                                                                      |
| `company_id`         | `uuid`          | not null, FK                                                                                                            |
| `code`               | `text`          | not null. Business key (legacy `poNo`, e.g. `IN-JWPO-00001`)                                                            |
| `po_date`            | `date`          | not null                                                                                                                |
| `po_type`            | `po_type`       | not null, default `'standard'`                                                                                          |
| `vendor_id`          | `uuid`          | nullable, FK → `vendors(id)`                                                                                            |
| `vendor_code_text`   | `text`          | nullable. Fallback (legacy `vendorCode`)                                                                                |
| `status`             | `po_status`     | not null, default `'draft'`                                                                                             |
| `due_date`           | `date`          | nullable. Header-level default; lines may override                                                                      |
| `tax_type`           | `text`          | nullable. Legacy values: `'sgst_cgst'`, `'igst'`, `'none'`. Free-text for now; promote to enum if a third value emerges |
| `sgst_pct`           | `numeric(5,2)`  | not null, default `0`                                                                                                   |
| `cgst_pct`           | `numeric(5,2)`  | not null, default `0`                                                                                                   |
| `igst_pct`           | `numeric(5,2)`  | not null, default `0`                                                                                                   |
| `pr_code_text`       | `text`          | nullable. Snapshot of legacy `prNo` for audit. Future: drop in favour of `purchase_requests.po_id` back-reference       |
| `approved_by`        | `uuid`          | nullable, FK → `users(id)`                                                                                              |
| `approved_at`        | `timestamptz`   | nullable                                                                                                                |
| `approval_remarks`   | `text`          | nullable                                                                                                                |
| `remarks`            | `text`          | nullable                                                                                                                |
| audit + `deleted_at` | (audit pattern) |                                                                                                                         |

Indexes:

- `unique (company_id, code) where deleted_at is null`
- `(company_id, vendor_id) where deleted_at is null`
- `(company_id, status) where deleted_at is null`
- `(company_id, po_date desc) where deleted_at is null`

RLS: same pattern as `purchase_requests`.

### `purchase_order_lines`

| Column               | Type            | Notes                                                                                                                     |
| -------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `id`                 | `uuid`          | PK                                                                                                                        |
| `company_id`         | `uuid`          | not null, FK                                                                                                              |
| `purchase_order_id`  | `uuid`          | not null, FK → `purchase_orders(id) on delete cascade`                                                                    |
| `line_no`            | `integer`       | not null                                                                                                                  |
| `item_id`            | `uuid`          | nullable, FK → `items(id)`                                                                                                |
| `item_code_text`     | `text`          | nullable. Fallback per ADR-012 #10                                                                                        |
| `item_name`          | `text`          | not null. Snapshot at PO creation                                                                                         |
| `qty`                | `integer`       | not null, check `> 0`                                                                                                     |
| `rate`               | `numeric(12,2)` | not null, default `0`                                                                                                     |
| `received_qty`       | `integer`       | not null, default `0`. Maintained by GRN cascade (T-035c+)                                                                |
| `due_date`           | `date`          | nullable                                                                                                                  |
| `source_so_line_id`  | `uuid`          | nullable, FK → `sales_order_lines(id) on delete set null`. Cost-rollup link; legacy carries `soRefId` on PO line          |
| `source_jc_op_id`    | `uuid`          | nullable, FK → `jc_ops(id) on delete set null`. Outsource workflow link; replaces legacy `outsource_po_no` text on jc_ops |
| `line_remarks`       | `text`          | nullable                                                                                                                  |
| audit + `deleted_at` | (audit pattern) |                                                                                                                           |

Indexes:

- `unique (purchase_order_id, line_no) where deleted_at is null`
- `(item_id) where deleted_at is null`
- `(source_so_line_id) where source_so_line_id is not null`
- `(source_jc_op_id) where source_jc_op_id is not null`

CHECK: `received_qty >= 0` and `received_qty <= qty + (qty * 0.1)` — allow 10% over-receipt to handle legitimate vendor over-shipments without blocking GRN; tighten later if needed.

RLS: same pattern as parent.

### `goods_receipt_notes`

Header table for GRNs. Records material received against a PO. Current data: 3 lines all under one GRN.

| Column               | Type            | Notes                                                                                             |
| -------------------- | --------------- | ------------------------------------------------------------------------------------------------- |
| `id`                 | `uuid`          | PK                                                                                                |
| `company_id`         | `uuid`          | not null, FK                                                                                      |
| `code`               | `text`          | not null. Business key (legacy `grnNo`, e.g. `IN-GRN-00001`)                                      |
| `grn_date`           | `date`          | not null                                                                                          |
| `purchase_order_id`  | `uuid`          | nullable, FK → `purchase_orders(id) on delete set null`. Resolved from legacy `poNo` text on load |
| `po_code_text`       | `text`          | nullable. Audit snapshot                                                                          |
| `vendor_id`          | `uuid`          | nullable, FK → `vendors(id)`                                                                      |
| `vendor_code_text`   | `text`          | nullable. Fallback                                                                                |
| `dc_no`              | `text`          | nullable. Vendor's DC reference                                                                   |
| `invoice_no`         | `text`          | nullable                                                                                          |
| `remarks`            | `text`          | nullable                                                                                          |
| audit + `deleted_at` | (audit pattern) |                                                                                                   |

Indexes:

- `unique (company_id, code) where deleted_at is null`
- `(company_id, purchase_order_id) where deleted_at is null`
- `(company_id, vendor_id) where deleted_at is null`
- `(company_id, grn_date desc) where deleted_at is null`

RLS: same pattern as `purchase_orders`.

### `goods_receipt_note_lines`

QC fields are inline per ADR-015 #8 — legacy data co-locates them on the GRN line.

| Column                   | Type            | Notes                                                                                                                                                 |
| ------------------------ | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                     | `uuid`          | PK                                                                                                                                                    |
| `company_id`             | `uuid`          | not null, FK                                                                                                                                          |
| `goods_receipt_note_id`  | `uuid`          | not null, FK → `goods_receipt_notes(id) on delete cascade`                                                                                            |
| `line_no`                | `integer`       | not null                                                                                                                                              |
| `purchase_order_line_id` | `uuid`          | nullable, FK → `purchase_order_lines(id) on delete set null`. Resolved by loader via `(po code, item code)` tuple; null + anomaly when not resolvable |
| `item_id`                | `uuid`          | nullable, FK → `items(id)`                                                                                                                            |
| `item_code_text`         | `text`          | nullable. Fallback                                                                                                                                    |
| `item_name`              | `text`          | not null                                                                                                                                              |
| `received_qty`           | `integer`       | not null, check `>= 0`                                                                                                                                |
| `dc_ref_no`              | `text`          | nullable. Per-line DC ref (legacy `dcRefNo` differs from header `dcNo` when split shipments)                                                          |
| `qc_status`              | `grn_qc_status` | not null, default `'pending'`                                                                                                                         |
| `qc_accepted_qty`        | `integer`       | not null, default `0`, check `>= 0`                                                                                                                   |
| `qc_rejected_qty`        | `integer`       | not null, default `0`, check `>= 0`                                                                                                                   |
| `qc_date`                | `date`          | nullable                                                                                                                                              |
| `qc_remarks`             | `text`          | nullable                                                                                                                                              |
| `qc_inspected_by`        | `uuid`          | nullable, FK → `users(id)`                                                                                                                            |
| `remarks`                | `text`          | nullable                                                                                                                                              |
| audit + `deleted_at`     | (audit pattern) |                                                                                                                                                       |

Indexes:

- `unique (goods_receipt_note_id, line_no) where deleted_at is null`
- `(purchase_order_line_id) where purchase_order_line_id is not null`
- `(item_id) where deleted_at is null`
- `(company_id, qc_status) where deleted_at is null` — drives the QC pending dashboard

CHECK: `qc_accepted_qty + qc_rejected_qty <= received_qty` — QC outcome can't exceed what was received.

RLS:

- `goods_receipt_note_lines_company_read` (any role)
- `goods_receipt_note_lines_manager_write` for INSERT/DELETE (admin/manager)
- `goods_receipt_note_lines_qc_update` — special policy: QC role may UPDATE only the QC fields (`qc_status`, `qc_accepted_qty`, `qc_rejected_qty`, `qc_date`, `qc_remarks`, `qc_inspected_by`). Enforced via column-level GRANT + a CHECK policy that no other column changes vs OLD row. Defined now for forward-compat with Phase 6 QC role; no qc-role user exists today.

### `store_transactions`

Stock-movement ledger. Polymorphic source via `source_type` enum + `source_ref text`. Append-only — corrections happen via reversing entries (same pattern as op_log per ADR-011 #4).

| Column               | Type                    | Notes                                                                                                  |
| -------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `id`                 | `uuid`                  | PK                                                                                                     |
| `company_id`         | `uuid`                  | not null, FK                                                                                           |
| `txn_date`           | `date`                  | not null                                                                                               |
| `item_id`            | `uuid`                  | nullable, FK → `items(id)`                                                                             |
| `item_code_text`     | `text`                  | nullable. Fallback                                                                                     |
| `txn_type`           | `store_txn_type`        | not null. `in` / `out` / `adjust`                                                                      |
| `qty`                | `integer`               | not null. Always positive — sign comes from `txn_type`                                                 |
| `source_type`        | `store_txn_source_type` | not null. `grn_qc` / `manual_adjust` / `dispatch` / `jw_in` / `jw_out` / `qc_accept` / `other`         |
| `source_ref`         | `text`                  | not null. Polymorphic ref (e.g. `IN-GRN-00001`); FK columns added in later phases when types stabilise |
| `stock_before`       | `integer`               | not null. Snapshot at txn time (legacy carries this)                                                   |
| `stock_after`        | `integer`               | not null. = stock_before ± qty                                                                         |
| `remarks`            | `text`                  | nullable                                                                                               |
| audit (created_only) | (audit pattern)         | created*by + created_at; no updated*\*, no deleted_at                                                  |

Indexes:

- `(company_id, item_id, txn_date desc)` — drives stock-history queries on item detail
- `(company_id, source_type, source_ref)` — find all txns from a given GRN / dispatch / etc.
- `(company_id, txn_date desc)` — daily ledger view

CHECK: `qty > 0`, `stock_after = stock_before + (case txn_type when 'in' then qty when 'adjust' then qty - 2*stock_before /* placeholder */ else -qty end)` — actually simpler: trust the writer to compute stock_before/stock_after correctly; revisit if drift surfaces. (Legacy maintained these client-side.)

RLS: read for any role; write only via service-layer paths (no direct UPDATE/DELETE allowed from app code).

### `v_item_stock` view

Per-item stock balance derived from `store_transactions`. Used by stock checks during BOM expansion / SO creation / etc.

```sql
CREATE VIEW public.v_item_stock AS
SELECT
  st.company_id,
  st.item_id,
  SUM(CASE WHEN st.txn_type = 'in'  THEN st.qty
           WHEN st.txn_type = 'out' THEN -st.qty
           ELSE st.qty END)::integer AS on_hand_qty
FROM public.store_transactions st
WHERE st.item_id IS NOT NULL
GROUP BY st.company_id, st.item_id;
```

(Note: `adjust` rows can be either + or − depending on the adjustment direction; legacy data has none. The CASE above treats `adjust` as positive — confirm against the first real adjustment we see.)

### `jc_ops` — Phase 5 ALTERS (applied)

Per ADR-015 #5. Sequence (all complete):

1. **Add columns** (T-035b, migration `0009_phase5_procurement.sql`): `outsource_pr_id uuid nullable references purchase_requests(id) on delete set null` and `outsource_po_line_id uuid nullable references purchase_order_lines(id) on delete set null`.
2. **Add index** on each new FK column where non-null.
3. **Backfill** (T-035c): for each jc_op with the legacy `outsource_pr_no` / `outsource_po_no` text, looked up the corresponding new row by code → set the FK. Anomaly + null on miss (matching ADR-012 #10 fallback semantics).
4. **Drop legacy text columns** `outsource_pr_no` and `outsource_po_no` (migration `0014_phase5_jc_ops_drop_legacy.sql`, 2026-05-04 in commit `994feef`) after backfill verified by `validate-phase5.ts`. The FK columns are the source of truth going forward; the canonical column list above already reflects the post-drop schema.

`outsource_pr_id` is also referenced as the inverse of `purchase_requests.source_jc_op_id` — the two FKs co-exist for query convenience (PR → JC op when looking from procurement; JC op → PR when looking from shop floor). They MUST stay in sync (set both at PR creation; both null after PR cancellation). Service layer enforces — no DB CHECK because cross-table CHECKs are unwieldy in Postgres without triggers.

### Phase 5 Triggers

`before update` on each new table → `set_updated_at()`. No status-maintenance triggers in T-035b — auto-close PO header (when all lines fully received + QC complete) lives in the service layer (T-035c+) where it's testable.

### Phase 5 Action items (T-035b implementation)

- [ ] Drizzle schema in `apps/api/src/db/schema.ts` — 5 new tables + 6 new enums + `jc_ops` ALTER (drop 2 text cols, add 2 FK cols)
- [ ] Migration: `0010_phase5_procurement.sql` (drizzle-gen — tables + enums + FKs + indexes + RLS) + `0011_phase5_jc_ops_alters.sql` (hand-written — drop legacy text cols, add FK cols, add indexes) + `0012_phase5_triggers.sql` (set_updated_at on the 5 new tables) + `0013_phase5_views.sql` (v_item_stock)
- [ ] Apply via the existing `apply-sql.ts` runner for the hand-written migrations
- [ ] Update SCHEMA.md "Migration History" with the four migration filenames

---

## Phase 6 Tables — Quality + Dispatch

> **Status:** T-038 + T-039 complete (2026-05-03 / 2026-05-04). ADR-016 (T-038 master-only reframe) and ADR-017 (T-039 NC + delivery challans + doc_missing carve-out) capture the design decisions. Per-inspection record table is still deferred to T-040 (where workflow UX drives schema).

Replaces legacy collection: `qcProcesses` (5 records — MIR / MCR / DIR / Coating Inspection / TPI). Legacy `qcAssignments` and `qcDocUploads` are doc_missing (collections were never written by the legacy app — see Run 1 export anomalies in `docs/MIGRATION-LOG.md`).

Spec source: `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html`. Key references: `_selQCProcesses(...)` helper rendered on JC ops form (line 5877), Plan ops form (line 9548), Route Card ops form (line 10215). Selection writes the picked process `name` as a text snapshot into `op.operation`; the picked `defaultCycleTime` is copied to the op's `cycleTime`.

### `qc_processes`

Master-data lookup of QC step types. Used by JC-op / route-card-op / plan-op forms as a dropdown source. Operations themselves still store `op.operation` as text (no FK alter on `jc_ops` — see ADR-016 #3).

| Column                   | Type            | Notes                                                                                                                                                              |
| ------------------------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                     | `uuid`          | PK                                                                                                                                                                 |
| `company_id`             | `uuid`          | not null, FK                                                                                                                                                       |
| `code`                   | `text`          | not null. Business key (legacy `name` field, e.g. `MIR`, `MCR`, `DIR`, `Coating Inspection`, `TPI`). Functions as both unique key and display label per ADR-016 #2 |
| `description`            | `text`          | nullable. Long-form (e.g. `Material Identification Report`)                                                                                                        |
| `default_cycle_time_min` | `numeric(8,2)`  | not null, default `0`. Legacy `defaultCycleTime` (currently 0 for all 5; future ops can set non-zero defaults)                                                     |
| `is_active`              | `boolean`       | not null, default `true`. Legacy `status='Active'` → true; anything else → false                                                                                   |
| audit + `deleted_at`     | (audit pattern) |                                                                                                                                                                    |

Indexes:

- `unique (company_id, code) where deleted_at is null`
- `(company_id, is_active) where deleted_at is null` — drives the "active processes only" dropdown

RLS:

- `qc_processes_company_read` (any role)
- `qc_processes_manager_write` (admin/manager only)

### Phase 6 Triggers (T-038)

`before update` on `qc_processes` → `set_updated_at()`. Same pattern as Phase 2/3/4/5 master/transactional tables.

### Phase 6 Action items (T-038 implementation, single chunk)

- [x] Drizzle schema in `apps/api/src/db/schema.ts` — 1 new master table
- [x] Migration: drizzle-gen tables + indexes + RLS + hand-written `set_updated_at` trigger (apply via `apply-sql.ts` per the Phase 5 pattern around the journal-orphan workaround)
- [x] Transform layer: 1 new transform (`migration/transforms/qc-processes.ts`) with status normalisation + numeric coercion
- [x] Load: extend `migration/load.ts` with QC_PROCESS_MAPPER + ALL_TABLES entry
- [x] Validate: minimal `migration/validate-phase6.ts` (extended in T-039 with NC + dispatch tables)
- [x] Update SCHEMA.md "Migration History" with the new migration filenames

### Phase 6 Tables — NC + Dispatch (T-039)

Replaces legacy collections: `ncRegister` (3 records — NC-0001/0002/0003) + `challans` (4 records — DC-00001/00001-02/00001-03/00002). Legacy `dispatchLog`, `jwDCOutward`, `jwDCInward`, `partyMaterials`, `partyGrn`, `ospDC`, `outsourceJobs`, `storeIssues` are all `doc_missing` and intentionally not migrated per ADR-017 #1.

Spec source: `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html`. Key references: NC create `_addManualNC` (line 22565), NC dispose `_disposeNC` (line 22618), NC filters / status enum (line 22555-22556), DC create `printChallan` (line 26133).

#### `nc_register`

Per-NC events. Auto-created when QC rejects parts (legacy `_autoCreateNC` line 22469) or manually filed via the Report NC button. Disposition workflow: `pending` → `disposed` → `closed` (Scrap / Use As Is / Return to Vendor / Make Fresh paths) OR `pending` → `disposed` (Rework picked) → `rework_done` → `closed`.

| Column                | Type                      | Notes                                                                                                                    |
| --------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `id`                  | `uuid`                    | PK                                                                                                                       |
| `company_id`          | `uuid`                    | not null, FK                                                                                                             |
| `code`                | `text`                    | not null. Business unique key — legacy `ncNo` (e.g. NC-0001)                                                             |
| `nc_date`             | `date`                    | not null                                                                                                                 |
| `job_card_id`         | `uuid`                    | not null, FK → `job_cards`. NC always links to a JC in legacy                                                            |
| `jc_op_id`            | `uuid`                    | nullable, FK → `jc_ops` (`on delete set null`). Resolved via composite `(jcNo, opSeq)`                                   |
| `op_seq`              | `integer`                 | nullable. Denormalised from legacy `opSeq` for fast filter                                                               |
| `operation_text`      | `text`                    | text snapshot of `jc_ops.operation` (e.g. `DIR`)                                                                         |
| `qc_operation_text`   | `text`                    | legacy `qcOperation` field                                                                                               |
| `item_id`             | `uuid`                    | not null, FK → `items`                                                                                                   |
| `item_code_text`      | `text`                    | not null. Snapshot                                                                                                       |
| `item_name_text`      | `text`                    | snapshot                                                                                                                 |
| `so_code_text`        | `text`                    | denormalised SO ref text. No FK — indirect path is JC → SO line                                                          |
| `machine_code_text`   | `text`                    | legacy `machineId` (often `QC` which isn't a real machine code)                                                          |
| `rejected_qty`        | `numeric(12,2)`           | not null. CHECK > 0                                                                                                      |
| `reason_category`     | enum `nc_reason_category` | not null, default `other`. 7 values: dimensional / surface / material / process / operator_error / machine_fault / other |
| `reason`              | `text`                    | free-text problem description                                                                                            |
| `disposition`         | enum `nc_disposition`     | nullable. 5 values: rework / scrap / use_as_is / return_to_vendor / make_fresh. NULL when status=`pending`               |
| `disposition_date`    | `date`                    | nullable                                                                                                                 |
| `disposition_by_text` | `text`                    | nullable. Name string snapshot (no operator FK per ADR-017 #3)                                                           |
| `disposition_remarks` | `text`                    | nullable                                                                                                                 |
| `rework_jc_code_text` | `text`                    | nullable. Legacy `reworkJcNo` — text snapshot only                                                                       |
| `rework_op_seq`       | `integer`                 | nullable                                                                                                                 |
| `rework_done_qty`     | `numeric(12,2)`           | nullable. CHECK >= 0 when set                                                                                            |
| `scrap_cost`          | `numeric(12,2)`           | not null, default 0                                                                                                      |
| `status`              | enum `nc_status`          | not null, default `pending`. 4 values: pending / disposed / rework_done / closed                                         |
| `reported_by_text`    | `text`                    | nullable                                                                                                                 |
| `time_logged`         | `timestamptz`             | nullable                                                                                                                 |
| audit + `deleted_at`  | (audit pattern)           |                                                                                                                          |

Indexes:

- `unique (company_id, code) where deleted_at is null`
- `(company_id, status) where deleted_at is null`
- `(company_id, job_card_id) where deleted_at is null`
- `(company_id, nc_date) where deleted_at is null`
- `(jc_op_id) where jc_op_id is not null`
- `(item_id)`

CHECK constraints:

- `nc_register_rejected_qty_positive` — `rejected_qty > 0`
- `nc_register_rework_done_qty_check` — `rework_done_qty IS NULL OR rework_done_qty >= 0`

RLS:

- `nc_register_company_read` (any role)
- `nc_register_manager_write` (admin/manager)

#### `delivery_challans` (header)

Outbound DC against a JW PO — material sent to vendor for outsource processing (returnable). Legacy `printChallan` (line 26133) creates these against `purchaseOrders` rows whose `poType='jw'`. Header→lines split mirrors PO/SO/JW pattern.

| Column                | Type             | Notes                                                                                                                                                           |
| --------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                  | `uuid`           | PK                                                                                                                                                              |
| `company_id`          | `uuid`           | not null, FK                                                                                                                                                    |
| `code`                | `text`           | not null. Business unique key — legacy `dcNo` (e.g. DC-00001, DC-00001-02)                                                                                      |
| `dc_date`             | `date`           | not null                                                                                                                                                        |
| `purchase_order_id`   | `uuid`           | nullable, FK → `purchase_orders` (`on delete set null`). NULL when legacy `poNo` references a PO never migrated (DC-00002 → IN-PO-00002 is the current example) |
| `po_code_text`        | `text`           | not null. Durable poNo snapshot                                                                                                                                 |
| `vendor_id`           | `uuid`           | not null, FK → `vendors`                                                                                                                                        |
| `vendor_code_text`    | `text`           | not null. Snapshot                                                                                                                                              |
| `sales_order_line_id` | `uuid`           | nullable, FK → `sales_order_lines` (`on delete set null`). Resolves legacy short-id `soRefId` via the in-run `idMap['sales_order_lines']`                       |
| `so_ref_text`         | `text`           | nullable. Original soRefId string preserved even when FK is NULL                                                                                                |
| `transport`           | `text`           | nullable                                                                                                                                                        |
| `status`              | enum `dc_status` | not null, default `issued`. 3 values: issued / received / cancelled. Only `issued` is exhibited; the other two are forward states                               |
| audit + `deleted_at`  |                  |                                                                                                                                                                 |

Indexes:

- `unique (company_id, code) where deleted_at is null`
- `(company_id, dc_date) where deleted_at is null`
- `(company_id, purchase_order_id) where deleted_at is null`
- `(company_id, status) where deleted_at is null`
- `(sales_order_line_id) where sales_order_line_id is not null`

RLS:

- `delivery_challans_company_read` (any role)
- `delivery_challans_manager_write` (admin/manager)

#### `delivery_challan_lines`

| Column                   | Type            | Notes                                                                                                                                                                                                                                                                                                                                            |
| ------------------------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                     | `uuid`          | PK                                                                                                                                                                                                                                                                                                                                               |
| `company_id`             | `uuid`          | not null, FK                                                                                                                                                                                                                                                                                                                                     |
| `delivery_challan_id`    | `uuid`          | not null, FK → `delivery_challans` (`on delete cascade`)                                                                                                                                                                                                                                                                                         |
| `line_no`                | `integer`       | not null. 1-indexed within DC, auto-assigned in source order                                                                                                                                                                                                                                                                                     |
| `item_id`                | `uuid`          | not null, FK → `items`                                                                                                                                                                                                                                                                                                                           |
| `item_code_text`         | `text`          | not null. Snapshot                                                                                                                                                                                                                                                                                                                               |
| `item_name_text`         | `text`          | nullable. Snapshot                                                                                                                                                                                                                                                                                                                               |
| `qty`                    | `numeric(12,2)` | not null. CHECK > 0                                                                                                                                                                                                                                                                                                                              |
| `uom`                    | enum `uom`      | not null. All current rows are `NOS`                                                                                                                                                                                                                                                                                                             |
| `material_text`          | `text`          | nullable. Legacy line `material` field                                                                                                                                                                                                                                                                                                           |
| `dc_remarks`             | `text`          | nullable                                                                                                                                                                                                                                                                                                                                         |
| `purchase_order_line_id` | `uuid`          | nullable, FK → `purchase_order_lines` (`on delete set null`). Added T-059a (2026-05-18). Links a DC line to the JW PO line being shipped against; cascade uses this to find the linked `jc_op` via `jc_ops.outsource_po_line_id`. Nullable so non-JW DCs (free-standing dispatch) still work — only DCs issued against a JW PO populate this FK. |
| audit + `deleted_at`     |                 |                                                                                                                                                                                                                                                                                                                                                  |

Indexes:

- `unique (delivery_challan_id, line_no) where deleted_at is null`
- `(item_id)`
- `(purchase_order_line_id) where purchase_order_line_id is not null` (T-059a)

CHECK: `delivery_challan_lines_qty_positive` — `qty > 0`.

RLS:

- `delivery_challan_lines_company_read` (any role)
- `delivery_challan_lines_manager_write` (admin/manager)

### Phase 6 Triggers (T-039)

`before update` on `nc_register`, `delivery_challans`, `delivery_challan_lines` → `set_updated_at()`. Same helper as Phase 2/3/4/5.

#### `delivery_challan_receipts` (T-059b)

Inward records against an outsource DC. Receipts are many-per-DC (partial receives over time). Header captures receipt date + vendor invoice; lines record per-DC-line received + rejected qty with required reject reason.

| Column                                         | Type                | Notes                                                            |
| ---------------------------------------------- | ------------------- | ---------------------------------------------------------------- |
| `id`                                           | `uuid`              | PK                                                               |
| `company_id`                                   | `uuid`              | not null, FK                                                     |
| `delivery_challan_id`                          | `uuid`              | not null, FK → `delivery_challans(id)` ON DELETE CASCADE         |
| `receipt_code`                                 | `text`              | not null. Auto-generated `RCPT-<dcCode>-NN`. Unique per company. |
| `receipt_date`                                 | `date`              | not null                                                         |
| `vendor_invoice_text`                          | `text`              | optional vendor invoice / gate-pass reference                    |
| `remarks`                                      | `text`              | optional                                                         |
| `created_at/by`, `updated_at/by`, `deleted_at` | standard audit cols |

Indexes:

- `delivery_challan_receipts_company_code_uniq` UNIQUE on (`company_id`, `receipt_code`) WHERE `deleted_at IS NULL`
- `delivery_challan_receipts_dc_idx` on (`delivery_challan_id`) WHERE `deleted_at IS NULL`
- `delivery_challan_receipts_company_date_idx` on (`company_id`, `receipt_date`) WHERE `deleted_at IS NULL`

RLS:

- `delivery_challan_receipts_company_read` (any role)
- `delivery_challan_receipts_manager_write` (admin/manager)

#### `delivery_challan_receipt_lines` (T-059b)

| Column                                         | Type                | Notes                                                            |
| ---------------------------------------------- | ------------------- | ---------------------------------------------------------------- |
| `id`                                           | `uuid`              | PK                                                               |
| `company_id`                                   | `uuid`              | not null, FK                                                     |
| `receipt_id`                                   | `uuid`              | not null, FK → `delivery_challan_receipts(id)` ON DELETE CASCADE |
| `delivery_challan_line_id`                     | `uuid`              | not null, FK → `delivery_challan_lines(id)` ON DELETE CASCADE    |
| `received_qty`                                 | `numeric(12,2)`     | not null, ≥ 0                                                    |
| `rejected_qty`                                 | `numeric(12,2)`     | not null, ≥ 0, default 0                                         |
| `reject_reason`                                | `text`              | required when `rejected_qty > 0` (DB CHECK)                      |
| `remarks`                                      | `text`              | optional                                                         |
| `created_at/by`, `updated_at/by`, `deleted_at` | standard audit cols |

CHECKs:

- `dcr_lines_qty_nonneg` — `received_qty >= 0 AND rejected_qty >= 0`
- `dcr_lines_qty_positive_sum` — `received_qty + rejected_qty > 0`
- `dcr_lines_reject_reason_when_rejected` — `rejected_qty = 0 OR reject_reason IS NOT NULL`

Indexes:

- `delivery_challan_receipt_lines_receipt_idx` on (`receipt_id`) WHERE `deleted_at IS NULL`
- `delivery_challan_receipt_lines_dc_line_idx` on (`delivery_challan_line_id`) WHERE `deleted_at IS NULL`

RLS:

- `delivery_challan_receipt_lines_company_read` (any role)
- `delivery_challan_receipt_lines_manager_write` (admin/manager)

#### `v_jc_op_status` view — receipt-aware patch (T-059b)

The view is replaced (DROP + CREATE) with two surgical changes so outsource ops behave correctly under the receive flow:

1. **`prev_output` CTE** — when projecting the output of an outsource op for the next op's `input_avail`, use `outsource_received_qty - outsource_rejected_qty` (summed from the receipts table) instead of `completed_qty` (always 0 for outsource ops).
2. **`computed_status`** — a new `WHEN op_type='outsource' AND outsource_status='received' THEN 'complete'` clause is added BEFORE the existing outsource sub-state CASE. This makes `v_jc_status.done_ops` count fully-received outsource ops as complete, which is what the sales-cascade keys off (`tryCascadeJcComplete`).

The new `outsource_receipts_rollup` CTE joins receipt_lines through dc_lines (by `purchase_order_line_id`) and excludes cancelled / deleted DCs.

### Phase 6 Action items (T-039 implementation, single chunk)

- [x] 4 new enums in `packages/shared/src/enums/` (`nc_status`, `nc_disposition`, `nc_reason_category`, `dc_status`) + index.ts wiring
- [x] Drizzle schema in `apps/api/src/db/schema.ts` — 3 new tables + 4 new pgEnum exports
- [x] Migration: `0011_phase6_nc_dispatch.sql` (drizzle-gen) + `0012_phase6_nc_dispatch_triggers.sql` (hand-written), applied via `apply-sql.ts`
- [x] Transform layer: 2 new transforms (`migration/transforms/nc-register.ts` + `migration/transforms/delivery-challans.ts`) with 16 unit tests
- [x] Load: extend `migration/load.ts` with 3 mappers + TABLE_CONFIGS + ALL_TABLES entries
- [x] Validate: extend `migration/validate-phase6.ts` to cover 4 tables + 16 FK orphan checks
- [x] Update SCHEMA.md "Migration History" with the new migration filenames

---

## Phase 7 Tables — Reports + Alerts

> **Status:** `saved_reports` (T-041b) + `alert_config` (T-041d Phase A) + `alert_subscriptions` + `alert_deliveries` (T-041d Phase B slice 6) shipped. Push delivery activates when `REDIS_URL` + `RESEND_API_KEY` + `ALERTS_PUSH_ENABLED=true` + `ALERTS_FROM_EMAIL` are set; tables work without those infra deps.

### `saved_reports`

User-defined ad-hoc reports built via the drag-and-drop builder (T-041b, ADR-018). Per-user private OR shared-with-company. Service-layer gate enforces shared/private edits (RLS does company isolation only).

| Column               | Type            | Notes                                                                             |
| -------------------- | --------------- | --------------------------------------------------------------------------------- |
| `id`                 | `uuid`          | PK                                                                                |
| `company_id`         | `uuid`          | not null, FK                                                                      |
| `owner_id`           | `uuid`          | not null, FK → `users(id)`                                                        |
| `name`               | `text`          | not null. Unique within `(company_id, owner_id)` while not soft-deleted           |
| `description`        | `text`          | not null, default `''`                                                            |
| `source_key`         | `text`          | not null. Whitelist key into the source catalog (sales-orders, items-stock, etc.) |
| `spec`               | `jsonb`         | not null. `AdHocSpec` shape — columns / filters / group-by / sort                 |
| `is_shared`          | `boolean`       | not null, default `false`                                                         |
| audit + `deleted_at` | (audit pattern) |                                                                                   |

Indexes:

- `unique (company_id, owner_id, name) where deleted_at is null`
- `(company_id, is_shared) where deleted_at is null` — drives shared-list queries
- `(owner_id) where deleted_at is null`

RLS: `saved_reports_company_read` + `saved_reports_company_write` (any authenticated company member). Owner / admin-manager edit gate is service-layer; RLS keeps the multi-tenant boundary only.

### `alert_config`

Per-company per-rule on/off override for the hard-coded alert registry (`apps/api/src/modules/alerts/definitions/`). Per ADR-024: rule definitions are code, this table only persists deviations from the registry's default `active` flag.

| Column       | Type                             | Notes                                                             |
| ------------ | -------------------------------- | ----------------------------------------------------------------- |
| `id`         | `uuid`                           | PK                                                                |
| `company_id` | `uuid`                           | not null, FK                                                      |
| `code`       | `text`                           | not null. Rule code from the registry (e.g. `AL-001`)             |
| `active`     | `boolean`                        | not null. The per-company override. Absent row = registry default |
| audit        | (audit pattern, no `deleted_at`) |                                                                   |

Indexes:

- `unique (company_id, code)`

RLS:

- `alert_config_company_read` (any role) — operators see the dashboard
- `alert_config_manager_write` (admin/manager only — operators can't change toggles)

No soft-delete: a row IS the override. If a rule code disappears from the registry, the orphaned row is harmless leftover (service skips unknown codes).

### `alert_subscriptions`

Per-user opt-in to email digest delivery for a specific alert code. v1 ships `email` as the only channel; the column shape leaves room for `slack` / `sms` later. No soft-delete — a row IS the subscription, an unsubscribe is a `DELETE`.

| Column       | Type                             | Notes                                                     |
| ------------ | -------------------------------- | --------------------------------------------------------- |
| `id`         | `uuid`                           | PK                                                        |
| `company_id` | `uuid`                           | not null, FK                                              |
| `user_id`    | `uuid`                           | not null, FK → `users(id)` ON DELETE CASCADE              |
| `code`       | `text`                           | not null. Rule code from the registry (e.g. `AL-001`)     |
| `channel`    | `text`                           | not null, default `'email'`. Reserved for future channels |
| audit        | (audit pattern, no `deleted_at`) |                                                           |

Indexes:

- `unique (company_id, user_id, code, channel)` — drives upsert + dedupe
- `(company_id, code)` — drives the worker's fan-out query

RLS:

- `alert_subs_company_read` (any role) — anyone in the company can read (admin/manager UI shows who's subscribed; users see their own subs)
- `alert_subs_self_or_manager_write` — the row's own `user_id` can write OR admin/manager can write any user's row

Trigger: `alert_subscriptions_set_updated_at` BEFORE UPDATE → `set_updated_at()`.

### `alert_deliveries`

Append-only audit log of dispatch attempts. The unique key `(code, user_id, window_start, channel)` is the worker's idempotency key — a second tick within the same window hits `unique_violation` and skips the Resend dispatch. Same shape as `activity_log`: no `updated_at`, no `deleted_at`.

| Column         | Type          | Notes                                                                                           |
| -------------- | ------------- | ----------------------------------------------------------------------------------------------- |
| `id`           | `uuid`        | PK                                                                                              |
| `company_id`   | `uuid`        | not null, FK                                                                                    |
| `user_id`      | `uuid`        | not null, FK → `users(id)` ON DELETE CASCADE                                                    |
| `code`         | `text`        | not null. Rule code dispatched                                                                  |
| `channel`      | `text`        | not null, default `'email'`                                                                     |
| `window_start` | `timestamptz` | not null. The 30-minute boundary the dispatch was scheduled for. Worker truncates `now()` to it |
| `message_id`   | `text`        | not null. Resend's id on a real send, or `'stub-…'` in log-only mode (`RESEND_API_KEY` unset)   |
| `record_count` | `integer`     | not null, default `0`. How many alert records were in the digest at dispatch time. Audit signal |
| `real_send`    | `boolean`     | not null. `true` when Resend actually sent, `false` when the wrapper stubbed                    |
| `created_at`   | `timestamptz` | not null, default `now()`                                                                       |
| `created_by`   | `uuid`        | nullable, FK → `users(id)` ON DELETE SET NULL — system writes leave it `null`                   |

Indexes:

- `unique (code, user_id, window_start, channel)` — idempotency key; worker relies on `INSERT … ON CONFLICT DO NOTHING` (or unique-violation catch) to skip duplicate sends within a window
- `(company_id, created_at DESC)` — drives admin audit listing if/when a UI for it ships

RLS:

- `alert_deliv_manager_read` (admin/manager only) — sensitive: who emailed who when
- `alert_deliv_self_insert` (INSERT only) — the row's own `user_id` is allowed to insert (the worker runs each dispatch under that subscriber's auth context). No app-level UPDATE / DELETE policies

### Phase 7 Triggers

`saved_reports` gets `before update` → `set_updated_at()`. `alert_config` doesn't currently have one — drizzle-gen didn't emit it, and the audit cols are only loosely-tracked here (admin self-edits are visible via `updated_at`/`updated_by` already set in service code on each upsert; a trigger would be belt-and-braces but isn't required). `alert_subscriptions` does get one (`alert_subscriptions_set_updated_at`) so subscription channel changes (when more channels land) bump the audit timestamp without service-layer ceremony. `alert_deliveries` is append-only — no trigger.

---

## Migration Notes (Phase 1 bootstrap)

The chicken-and-egg of `companies.created_by → users.id` and `users.company_id → companies.id` is resolved this way:

1. Initial migration creates both tables with FKs as `deferrable initially deferred`.
2. Seed inserts the first company and the first admin user inside one transaction.
3. The admin user is created in `auth.users` first (via Supabase Admin API in a one-shot setup script), the trigger creates the `public.users` row with `is_active=false`, then a SQL UPDATE sets `company_id` and `role='admin'` and `is_active=true`.
4. The `companies` row's `created_by` and `updated_by` point at this admin's id.

A separate setup script `migration/seed-admin.ts` will be added in T-005 / T-008 to do this idempotently.

## Migration History

| Date       | Migration                                                                                                                            | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-04-30 | `0000_initial.sql` + `0001_post_init.sql`                                                                                            | Phase 1 — companies, users, items + helpers + auth.users triggers (T-005)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2026-04-30 | `0002_tricky_fallen_one.sql` + `0003_phase2_triggers.sql`                                                                            | Phase 2 storage layer — clients, vendors, machines, operators tables, indexes, RLS, BEFORE UPDATE triggers (T-014; 0003 hand-written, applied out-of-band)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-05-01 | `0004_phase3_op_entry.sql` (drizzle-gen) + `0005_phase3_triggers.sql` (hand-written) + `0006_phase3_views.sql` (hand-written)        | Phase 3 op-entry chain (T-024b) — 7 tables (route_cards, route_card_ops, route_card_revisions, job_cards, jc_ops, op_log, running_ops), 6 enums, BEFORE UPDATE triggers, derived-status views (`v_jc_op_status`, `v_jc_status` mirroring legacy calcEngine). Hand-written migrations applied via `apps/api/src/db/apply-sql.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2026-05-01 | `0007_phase4_sales_chain.sql` (drizzle-gen) + `0008_phase4_jc_alters.sql` (hand-written) + `0009_phase4_triggers.sql` (hand-written) | Phase 4 sales chain (T-029b) — 4 tables (sales_orders, sales_order_lines, job_work_orders, job_work_order_lines), 2 enums (so_type, so_status — shared between SO and JW), BEFORE UPDATE triggers. Plus job_cards alters: rename `source_jw_id`→`source_jw_line_id`, add 2 FKs (ON DELETE SET NULL), add CHECK `num_nonnulls(...) <= 1`. FK names initially custom; renamed in-place to Drizzle convention via one-shot SQL; snapshot patched to match. No drift on `drizzle-kit generate`. 73/73 api tests still green                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-05-02 | `0009_phase5_procurement.sql` (drizzle-gen) + `0010_phase5_triggers.sql` (hand-written) + `0011_phase5_views.sql` (hand-written)     | Phase 5 procurement storage (T-035b) — 5 new tables (purchase_requests, purchase_orders, purchase_order_lines, goods_receipt_notes, goods_receipt_note_lines, store_transactions), 6 new enums (po_status, pr_status, po_type, grn_qc_status, store_txn_type, store_txn_source_type). Plus jc_ops adds 2 FK columns (outsource_pr_id → purchase_requests, outsource_po_line_id → purchase_order_lines) — legacy text columns (outsource_pr_no, outsource_po_no) kept until T-035c backfills then drops. BEFORE UPDATE triggers on the 5 new tables (store_transactions is append-only — no trigger). v_item_stock view aggregates per-item on-hand qty from store_transactions (ADR-015 #11). RLS: standard company-isolation + manager-write on all 5 tables; reserved goods_receipt_note_lines_qc_update policy for the QC role (no qc-role user yet — forward-defined for Phase 6). Applied via `apply-sql.ts` runner because the journal has an orphan `0008_verify_no_drift` entry from a stale run that breaks `drizzle-kit migrate`. No drift on `drizzle-kit generate`. 120/120 api tests still green |
| 2026-05-03 | `0010_phase6_qc_processes.sql` (drizzle-gen) + `0011_phase6_qc_processes_trigger.sql` (hand-written)                                 | Phase 6 quality master (T-038) — 1 new master table (qc_processes), 0 new enums. BEFORE UPDATE trigger via the standard `set_updated_at()` helper. RLS standard pair (company_read + manager_write). Applied via `apply-sql.ts` per the Phase 5 journal-orphan workaround. No FK alter on jc_ops per ADR-016 #3 (existing JC ops keep their text snapshot in `op.operation`). Per-inspection record table deferred to T-040. 175/175 api tests still green                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2026-05-04 | `0011_phase6_nc_dispatch.sql` (drizzle-gen) + `0012_phase6_nc_dispatch_triggers.sql` (hand-written)                                  | Phase 6 NC + dispatch (T-039) — 3 new tables (nc_register, delivery_challans, delivery_challan_lines), 4 new enums (nc_status, nc_disposition, nc_reason_category, dc_status). nc_register has hard FKs to job_cards + items + nullable jc_op_id; delivery_challans has nullable purchase_order_id + sales_order_line_id with text-snapshot durable columns to absorb legacy DC-00002 (poNo unmigrated) + 2-of-4 unresolvable soRefIds (ADR-017 #5). BEFORE UPDATE triggers on all 3 tables. Standard RLS pair (company_read + manager_write). Applied via `apply-sql.ts`. 175/175 api tests still green; migration suite 137/137 (was 121, +16 — 9 NC + 7 DC)                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-05-04 | `0013_phase6_nc_register_entry_write.sql` (hand-written)                                                                             | T-040a policy alter — replace `nc_register_manager_write` (admin/manager) with `nc_register_entry_write` (admin/manager/operator). Legacy `_addManualNC` (legacy line 22565) gates on `canEntry()` which includes operators; shop-floor NC reporting must work at the RLS layer. Drop+create idempotent. Snapshot `0011_snapshot.json` patched in-place to keep drizzle-kit drift-free. Service-layer continues to use `requireOpEntryRole` for explicit auth. 198/198 api tests green (was 175, +23 from T-040a)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-05-04 | `0012_phase6_jc_parent_nc.sql` (drizzle-gen)                                                                                         | T-040b schema alter — add `job_cards.parent_nc_id` (nullable FK → nc_register, ON DELETE SET NULL) + partial index `job_cards_parent_nc_idx`. Set when a JC was created by an NC `make_fresh` disposition; supplementary JC inherits source SO/JW link separately so the T-033 close cascade still works. Filename collides visually with existing `0012_phase6_nc_dispatch_triggers.sql` (hand-written) — same pattern as the 0009-0011 collision band; `apply-sql.ts` handles both fine. 209/209 api tests green (was 198, +11 from T-040b cascades)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-05-04 | `0014_phase5_jc_ops_drop_legacy.sql` (hand-written)                                                                                  | Phase 5 cleanup — drop legacy `jc_ops.outsource_pr_no` + `outsource_po_no` text columns (per ADR-015 #5; T-035c backfill ran 2026-05-02 and the FK columns `outsource_pr_id` / `outsource_po_line_id` are populated). Snapshot `0012_snapshot.json` patched to drop the columns; drizzle-kit confirms no drift. Cleaned up: `JC_OP_MAPPER` in `migration/load.ts` (drop the 2 keys), the now-dead `migration/load/jc-op-outsource-backfill.ts` script + its load.ts invocation block, the legacy-column refs in `migration/transforms/jc-ops.ts` mapper output (left as harmless transform-output keys), and `validate-phase3.ts` JC_OP_MAPPER + `validate-phase5.ts` `checkOutsourceBackfill` cross-check (the orphan FK checks on outsource_pr_id + outsource_po_line_id are the proper post-drop verification). validate-phase3 PASS (7/7 tables match, 0 orphan FKs across 25 checks); validate-phase5 PASS (6/6 tables, 0 orphan FKs across 32 checks); validate-phase6 PASS unchanged. 209/209 api tests still green; migration suite 137/137                                                           |
| 2026-05-05 | `0013_phase7_saved_reports.sql` (drizzle-gen) + `0014_phase7_saved_reports_trigger.sql` (hand-written)                               | Phase 7 saved (ad-hoc) reports (T-041b) — 1 new table `saved_reports` (id, company_id, owner_id, name, description, source_key, spec jsonb, is_shared, audit + soft-delete cols), 3 indexes (company+owner+name unique, company+is_shared, owner_id), standard company_isolation RLS pair (company_read + company_write — the per-user shared/private gate is enforced at the service layer to keep RLS simple; admin/manager elevation lives in the service too). BEFORE UPDATE trigger via the standard `set_updated_at()` helper. Applied via `apply-sql.ts` per the Phase 5 journal-orphan workaround. 259/259 api tests green (was 231, +28 from T-041b)                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-05-05 | `0015_phase8_activity_log.sql` (drizzle-gen)                                                                                         | Phase 8 activity log (T-051) — 1 new append-only audit table `activity_log` (id, company_id, ts, user_id [nullable, ON DELETE SET NULL], user_name [snapshot], action [text], entity, detail, ref_id, created_at, created_by). 3 indexes (company+ts, company+action, company+user). RLS: company_read for SELECT + manager_insert for INSERT only — no UPDATE / DELETE policies (append-only per ADR-019). No `updated_at` / `deleted_at`. Applied via `apply-sql.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-05-08 | `0015_phase7_alert_config.sql` (drizzle-gen)                                                                                         | Phase 7 alerts Phase A (T-041d, ADR-024) — 1 new table `alert_config` (id, company_id, code text, active boolean, audit cols; no soft-delete). Per-company per-rule on/off override; rule definitions live in code under `apps/api/src/modules/alerts/definitions/`. Unique index `(company_id, code)`. RLS: company_read (any role) + manager_write (admin/manager). Filename collides with `0015_phase8_activity_log.sql` — drizzle journal disambiguates by `idx`. Applied via `apply-sql.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2026-05-09 | `0016_phase7_alert_subs_deliveries.sql` (hand-written)                                                                               | Phase 7 alerts Phase B slice 6 (T-041d, ADR-024) — 2 new tables (`alert_subscriptions` per-user opt-in, `alert_deliveries` append-only audit log) + 1 new SQL helper `current_user_id()` (extracts JWT `sub` for self-row RLS). `alert_subscriptions` has FK ON DELETE CASCADE on `user_id` so a deleted user's subs vanish; idempotency unique key `(company_id, user_id, code, channel)` + `(company_id, code)` fan-out index; RLS company_read (any role) + self_or_manager_write. `alert_deliveries` keys idempotency on `(code, user_id, window_start, channel)`; `created_by` nullable for system writes; RLS manager_read + self_insert. BEFORE UPDATE trigger only on `alert_subscriptions` (deliveries are append-only). Applied via `apply-sql.ts`                                                                                                                                                                                                                                                                                                                                                  |
| 2026-05-15 | `0017_phase6_qc_accept_source.sql` (hand-written)                                                                                    | T-040f — `ALTER TYPE store_txn_source_type ADD VALUE IF NOT EXISTS 'qc_accept'`. Adds the source enum value used by op-entry's QC stock cascade (last-op QC accept writes a `store_transactions` IN row crediting the JC's item, mirrors legacy HTML L3923-3940). Single-statement non-transactional ALTER; applied cleanly via standard `apply-sql.ts` runner. No schema-shape change; the shared TS enum array also gets the value (ordering differs from Postgres which always appends — unimportant since no code orders by enumsortorder). 24/24 op-entry tests + 15/15 GRN tests green; v_item_stock view picks up the new source automatically                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2026-05-18 | `0018_phase6_dc_po_line_link.sql` (hand-written, idempotent)                                                                         | T-059a (ADR-026) — add nullable `delivery_challan_lines.purchase_order_line_id` (FK → `purchase_order_lines`, `ON DELETE SET NULL`) + partial index `delivery_challan_lines_po_line_idx` on non-null values. Lets the outward DC cascade find the linked `jc_op` via `jc_ops.outsource_po_line_id` and reverse cleanly on cancel. Nullable so non-JW DCs (free-standing dispatch) still work — only DCs issued against a JW PO populate the FK. Applied via DLP-friendly `_apply_0018.mjs` inlined applier (same pattern as 0016 alerts migration). 22/22 DC tests green                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-05-19 | `0019_phase6_dc_receipts.sql` (hand-written, idempotent)                                                                             | T-059b (ADR-026) — outsource receive-back. 2 new tables (`delivery_challan_receipts` header + `delivery_challan_receipt_lines` per-line received + rejected qty with required reject_reason CHECK). Both have `ON DELETE CASCADE` from their parent (DC for the header, dc_line for the receipt_line) so test cleanup + admin purges work without orphans. `v_jc_op_status` view is replaced (DROP + CREATE) with two surgical changes — `prev_output` CTE uses `received - rejected` for outsource ops, and a new `WHEN op_type='outsource' AND outsource_status='received' THEN 'complete'` clause makes `v_jc_status.done_ops` count fully-received outsource ops as complete so the sales-cascade fires. `v_jc_status` recreated unchanged. Applied via DLP-friendly `_apply_0019.mjs` inlined applier. 39/39 DC tests green (was 22, +17 from T-059b)                                                                                                                                                                                                                                                    |
| 2026-05-19 | `0020_phase7_item_stock_table.sql` (hand-written, idempotent)                                                                        | T-042 — materialize `v_item_stock` as an `item_stock_balances (company_id, item_id, on_hand_qty, updated_at)` table maintained by an AFTER INSERT trigger on `store_transactions` (`apply_store_txn_to_balance`, SECURITY DEFINER so direct app-level writes stay blocked — only the trigger writes). Backfill from existing ledger via `INSERT … ON CONFLICT DO UPDATE` (also re-usable as a reconcile). `v_item_stock` view rewritten to `SELECT * FROM item_stock_balances`, preserving the column contract so every caller (`getItemBalance`, qc-stock-cascade, GRN cascades, DC cascades, DC receipt cascades) works unchanged. Read cost drops from `SUM(N store_txns)` to single-row lookup; per-write cost is O(1) upsert. Items have `ON DELETE CASCADE` on the FK from balances, so item hard-delete cleans the cache. Applied via `_apply_0020.mjs`. 8/8 new trigger tests green + 92/92 dependent suites (GRN + DC + op-entry) green                                                                                                                                                              |
| 2026-05-20 | `0021_phase8_bom_master.sql` (hand-written, idempotent)                                                                              | BOM-1 (Phase A item 1 per ADR-028 / LEGACY_AUDIT.md) — port legacy `renderBOMMaster` (legacy L8438) to first-class Postgres schema. 3 new tables: `bom_masters` (header w/ bom_no, bom_name, revision integer auto-bumped on edit, status enum draft/active/obsolete), `bom_master_lines` (child_item_id FK + qty_per_set numeric + bom_type enum manufacture/purchase/outsource — unique constraint blocks duplicate items per BOM), `bom_master_revisions` (append-only audit; items_snapshot jsonb captures lines as they were at each revision). 2 new enums (`bom_status`, `bom_line_type`). ALTER `sales_order_lines` to add `source_bom_master_id uuid` FK with partial index — drives the BOM-8 cascade where SO line creation spawns child JC (manufacture) or PR (purchase / outsource) entities. RLS company_read + manager_write on header + lines; revisions get manager_insert only (append-only). Applied via `_apply_0021.mjs`. 24/24 BOM tests green + 40/40 dependent (BOM + sales-orders) green                                                                                            |
| 2026-05-20 | `0022_phase8_route_card_osp.sql` (hand-written, idempotent)                                                                          | RC-1 (Phase A item 2 per ADR-028 / ADR-029) — ALTER `route_card_ops` to add 3 nullable OSP fields: `osp_vendor_id uuid` (FK → vendors, `ON DELETE SET NULL`), `osp_vendor_code_text text` (free-text fallback per ADR-012 #10), `osp_lead_days integer` (default 5 in legacy form L10229). Lets route-card ops with `op_type='outsource'` carry the legacy `ospVendorCode` / `ospVendor` / `ospLeadDays` values that previously had nowhere to land. Single partial index on `osp_vendor_id` for the lookup. No CHECK constraint enforcing "outsource → vendor required" — service-layer Zod refine handles that conditionally so partial drafts stay editable. Applied via `_apply_0022.mjs`. 21/21 route-cards tests green                                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-05-20 | `0023_phase8_cost_centers.sql` (hand-written, idempotent)                                                                            | CC-1 (Phase A item 4 per ADR-028 / LEGACY_AUDIT.md) — new master `cost_centers` (id, company_id, code, name, department, type, description, is_active boolean + standard audit + soft-delete envelope). Mirrors legacy `renderCostCenters` L17165. Unique index `(company_id, code)` partial on `deleted_at IS NULL`; secondary index `(company_id, is_active)` for the active-filter dropdown. RLS company_read + manager_write (admin/manager only for inserts). `sales_orders.cost_center` (text column at schema.ts L912) already snapshots the code — promoting to FK is a future migration. Applied via `_apply_0023.mjs`. 11/11 cost-centers tests green                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2026-05-21 | `0025_phase8_assembly_units.sql` (hand-written, idempotent)                                                                          | PL-5 (Phase B item 5 per ADR-030) — Assembly Tracker tables. 2 new tables: (a) `assembly_units` — one row per assembled equipment unit (so_id FK CASCADE + unit_no with partial unique index per SO + serial_no nullable + assembly_date + assembledBy + bom_master_id FK SET NULL + dispatched boolean + dispatch_date/by/remarks + deductions jsonb snapshot column for stock movement at assembly time — read-only metadata, store_transactions remains source of truth). (b) `assembly_tracking` — manual override per (so_id, child_item_code) for the component readiness rollup (ready_qty_override int + child_item_id FK SET NULL for live link when item exists + remarks). Both tables CASCADE-delete from sales_orders. CHECK constraints: assembly_units.unit_no > 0 + assembly_tracking.ready_qty_override >= 0. Indexes: (so_id, unit_no) unique on assembly_units; (company_id, dispatched) + (serial_no WHERE not null) secondary; (so_id, child_item_code) unique on assembly_tracking. RLS company_read + manager_write on both. Applied via `_apply_0025.mjs`. 20/20 assembly tests green |
| 2026-05-21 | `0024_phase8_plans.sql` (hand-written, idempotent)                                                                                   | PL-3 (Phase B item 3 per ADR-030) — Planning module tables. 2 new tables (`plans` + `plan_ops`) + 2 new enums (`plan_status`: in_planning / planned / jc_created / pr_created / in_production / complete / cancelled; `plan_type`: manufacture / direct_purchase / full_outsource / assembly). `plans` is wide-nullable per (SO line × BOM child) grain mirroring legacy `db.plans`; DP / FO / manufacture / assembly fields coexist as nullable columns. Two CHECK constraints lock down the state machine at DB level: (a) `plans_type_status_check` enforces (type, status) legal combos (jc_created only with manufacture/assembly; pr_created only with direct_purchase/full_outsource); (b) `plans_status_fk_check` enforces status→FK requirements (jc_created → jc_id NOT NULL; pr_created direct_purchase → dp_pr_id NOT NULL; pr_created full_outsource → fo_pr_id NOT NULL). `plan_ops` is a child table per CLAUDE.md §12 #1 (not JSONB), mirrors `jc_ops` shape so PL-4 can copy ops 1:1 on Execute. 6 partial indexes (uniqueness, status, so_line, jc_id, item, date). RLS company_read + manager_write on both tables; service layer adds status-guarded write restriction (mutations only in_planning / planned). Applied via `_apply_0024.mjs`. 22/22 plans tests green |
