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

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `company_id` | `uuid` | not null, FK |
| `code` | `text` | not null. Business key (legacy `rcNo`, e.g. `IN-RC-00001`) |
| `item_id` | `uuid` | not null, FK → `items(id)`. Legacy `itemCode` |
| `current_revision` | `integer` | not null, default `1`. Bumped by service layer when ops mutate |
| `notes` | `text` | nullable |
| audit + `deleted_at` | (audit pattern) | |

Indexes:
- `unique (company_id, code) where deleted_at is null`
- `unique (company_id, item_id) where deleted_at is null` — one active route card per item per company (matches legacy `find(r=>r.itemCode===itemCode)` lookup pattern at line 6925)
- `(item_id) where deleted_at is null`

RLS: `route_cards_company_read` (any role, same company) + `route_cards_manager_write` (admin/manager only).

### `route_card_ops`

Live ops for the current revision of a route card. Editable. Copied to `jc_ops` at JC creation.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `company_id` | `uuid` | not null, FK |
| `route_card_id` | `uuid` | not null, FK → `route_cards(id) on delete cascade` |
| `op_seq` | `integer` | not null. 1-indexed sequence within route |
| `machine_id` | `uuid` | nullable, FK → `machines(id)`. Null for OSP-only steps (legacy `machineId: ""`) |
| `machine_code_text` | `text` | nullable. Preserves legacy `'QC'` sentinel and other free-text values that don't FK-resolve |
| `operation` | `text` | not null. Free-text op label (e.g. `'od turn'`, `'DIR'`, `'COATING'`) |
| `op_type` | `op_type` | not null, default `'process'` |
| `cycle_time_min` | `numeric(10,2)` | not null, default `0`. Minutes per piece |
| `program` | `text` | nullable |
| `tool_no` | `text` | nullable |
| `tool_details` | `text` | nullable |
| `qc_required` | `boolean` | not null, default `false` |
| audit + `deleted_at` | (audit pattern) | |

Indexes:
- `unique (route_card_id, op_seq) where deleted_at is null`
- `(machine_id) where deleted_at is null`

RLS: same pattern as parent.

### `route_card_revisions`

Append-only history of past route card revisions. Snapshot held as `jsonb` (archival, not queried by shape).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `company_id` | `uuid` | not null, FK |
| `route_card_id` | `uuid` | not null, FK → `route_cards(id) on delete cascade` |
| `revision_no` | `integer` | not null. 1-indexed |
| `notes` | `text` | nullable. Legacy `notes` (e.g. `"Updated"`) |
| `ops_snapshot` | `jsonb` | not null. Frozen array of ops at the time of revision |
| `created_at` | `timestamptz` | not null, default `now()` |
| `created_by` | `uuid` | not null, FK → `users(id)` |

(No `updated_at`/`deleted_at` — revisions are immutable history.)

Indexes:
- `unique (route_card_id, revision_no)`
- `(route_card_id, created_at desc)` — for revision-history view

RLS: `route_card_revisions_company_read` (any role).

### `job_cards`

Production batch on the shop floor for a specific item and quantity. Header table.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `company_id` | `uuid` | not null, FK |
| `code` | `text` | not null. Business key (legacy `jcNo`, e.g. `IN-JC-00001`) |
| `jc_date` | `date` | not null. Legacy `date` (creation/issue date) |
| `item_id` | `uuid` | not null, FK → `items(id)`. Legacy `itemCode` |
| `order_qty` | `integer` | not null, check `> 0` |
| `priority` | `jc_priority` | not null, default `'normal'` |
| `due_date` | `date` | nullable |
| `drawing_file_path` | `text` | nullable. Storage path; replaces legacy base64 `drawingData` |
| `source_so_line_id` | `uuid` | nullable. FK → `sales_order_lines(id)` **deferred to Phase 4** |
| `source_jw_id` | `uuid` | nullable. FK → `job_work_orders(id)` **deferred to Phase 4** |
| `source_legacy_ref` | `text` | nullable. Captures legacy `(soNo, soRefId, soLineNo, soPartName, clientPoLineNo)` as JSON-encoded text until Phase 4 backfills FKs |
| `closed_at` | `timestamptz` | nullable. Set when JC manually closed (legacy `'Closed'` status path) |
| audit + `deleted_at` | (audit pattern) | |

Indexes:
- `unique (company_id, code) where deleted_at is null`
- `(company_id, item_id) where deleted_at is null`
- `(company_id, due_date) where deleted_at is null and closed_at is null` — overdue JC reports
- `(company_id, jc_date) where deleted_at is null`

RLS: `job_cards_company_read` (any role) + `job_cards_manager_write` (admin/manager only — operators cannot create JCs, they only log against existing ones).

**No status column** — derived via `v_jc_status` view (decision #2). The view projects: `total_ops`, `done_ops`, `qc_pending_ops`, `status` (`no_ops` | `open` | `qc_pending` | `complete` | `closed`).

### `jc_ops`

Per-step routing of a job card. Snapshot copied from `route_card_ops` at JC creation; thereafter independent.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `company_id` | `uuid` | not null, FK |
| `job_card_id` | `uuid` | not null, FK → `job_cards(id) on delete cascade` |
| `op_seq` | `integer` | not null. 1-indexed within JC |
| `machine_id` | `uuid` | nullable, FK → `machines(id)` |
| `machine_code_text` | `text` | nullable. Preserves legacy `'QC'` and other unresolvable strings |
| `operation` | `text` | not null |
| `op_type` | `op_type` | not null, default `'process'` |
| `cycle_time_min` | `numeric(10,2)` | not null, default `0` |
| `program` | `text` | nullable |
| `tool_no` | `text` | nullable |
| `tool_details` | `text` | nullable |
| `qc_required` | `boolean` | not null, default `false` |
| `qc_call_date` | `date` | nullable. Auto-set when prior op completes (legacy line 5476) |
| `qc_attended_date` | `date` | nullable |
| `rework_qty` | `integer` | not null, default `0`. Counter, decremented by op-log entries (legacy line 5462) |
| `outsource_vendor_id` | `uuid` | nullable, FK → `vendors(id)`. Legacy `outsourceVendor` text resolved to FK; null if unresolvable |
| `outsource_vendor_text` | `text` | nullable. Fallback for unresolvable legacy vendor codes |
| `outsource_cost` | `numeric(12,2)` | not null, default `0` |
| `outsource_status` | `outsource_status` | nullable. Null for non-outsource ops; default `'pending'` when `op_type='outsource'` |
| `outsource_pr_no` | `text` | nullable. Until Phase 5 (procurement) ships |
| `outsource_po_no` | `text` | nullable |
| `outsource_dc_no` | `text` | nullable |
| `outsource_sent_qty` | `integer` | not null, default `0` |
| `outsource_sent_date` | `date` | nullable |
| `outsource_returned_qty` | `integer` | not null, default `0` |
| audit + `deleted_at` | (audit pattern) | |

Indexes:
- `unique (job_card_id, op_seq) where deleted_at is null`
- `(machine_id) where deleted_at is null`
- `(company_id, op_type) where deleted_at is null` — for outsource queue / QC dashboard filters
- `(outsource_vendor_id) where deleted_at is null and op_type = 'outsource'`

RLS: `jc_ops_company_read` (any role) + `jc_ops_manager_write` (admin/manager — operators don't edit op definitions, only log against them).

**No completed/accepted/rejected qty columns** — derived from `op_log` via `v_jc_op_status` view (decision #2).

### `op_log`

Append-only log of work events against a `jc_op`. Hot table — Realtime row-filterable.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `company_id` | `uuid` | not null, FK |
| `jc_op_id` | `uuid` | not null, FK → `jc_ops(id) on delete cascade` |
| `log_no` | `text` | not null. Legacy `logNo` (e.g. `LOG-022`); NOT unique — legacy generates duplicates (e.g. LOG-008 appears twice in source) |
| `log_type` | `op_log_type` | not null. `'start'` (qty=0, has start_time), `'complete'` (production), `'qc'` (qty=accepted, reject_qty=rejected) |
| `log_date` | `date` | not null |
| `shift` | `shift` | not null |
| `qty` | `integer` | not null, default `0`, check `>= 0`. For `'qc'` type: accepted qty |
| `reject_qty` | `integer` | not null, default `0`, check `>= 0`. For `'qc'` type: rejected qty; for `'complete'`: rejected during production |
| `operator_id` | `uuid` | nullable, FK → `operators(id)`. Best-effort name match during transform |
| `operator_name` | `text` | nullable. Preserved from legacy free-text |
| `start_time` | `time` | nullable. Set only when `log_type='start'` (HH:MM in legacy) |
| `remarks` | `text` | nullable |
| `created_at` | `timestamptz` | not null, default `now()` |
| `created_by` | `uuid` | not null, FK → `users(id)` |

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

Realtime: enable on this table; client subscribes filtered by `(company_id = X and jc_op_id = Y)` for the Op Entry screen.

### `running_ops`

Live session record. One row per (jc_op, attempt). Closed by setting `status = 'done'` (totalDone >= orderQty, line 5436) or `'stopped'` (manual stop, line 5703).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `company_id` | `uuid` | not null, FK |
| `jc_op_id` | `uuid` | not null, FK → `jc_ops(id) on delete cascade` |
| `machine_id` | `uuid` | nullable, FK → `machines(id)`. Null for OSP sessions (legacy uses `'OSP'` sentinel) |
| `is_osp` | `boolean` | not null, default `false`. Legacy `isOSP` flag |
| `operator_id` | `uuid` | nullable, FK → `operators(id)` |
| `operator_name` | `text` | nullable. Free-text fallback |
| `start_date` | `date` | not null |
| `start_time` | `time` | not null |
| `shift` | `shift` | not null |
| `status` | `running_op_status` | not null, default `'running'` |
| `ended_at` | `timestamptz` | nullable. Set when status transitions to `done` or `stopped` |
| audit (`created_at`, `created_by`, `updated_at`, `updated_by`) | (audit pattern, no `deleted_at`) | |

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
