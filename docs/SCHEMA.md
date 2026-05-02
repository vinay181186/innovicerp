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

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `company_id` | `uuid` | not null, FK |
| `code` | `text` | not null. Business key (legacy `soNo`, e.g. `SO-436`) |
| `so_date` | `date` | not null |
| `client_id` | `uuid` | nullable, FK → `clients(id)`. Resolved from legacy `clientId`/`clientCode` |
| `customer_name` | `text` | nullable. Free-text fallback (used when `client_id` is null) |
| `client_po_no` | `text` | nullable. Header-level PO ref (legacy `clientPoNo` on the SO header) |
| `type` | `so_type` | not null |
| `status` | `so_status` | not null, default `'open'` |
| `gst_percent` | `numeric(5,2)` | not null, default `18.00` |
| `bom_master_id` | `text` | nullable. Forward ref to BOM master (deferred to a later phase as FK) |
| `bom_status` | `text` | nullable. Equipment SOs only (e.g. `'BOM Pending'`) |
| `cost_center` | `text` | nullable |
| `remarks` | `text` | nullable |
| audit + `deleted_at` | (audit pattern) | |

Indexes:
- `unique (company_id, code) where deleted_at is null`
- `(company_id, client_id) where deleted_at is null`
- `(company_id, status) where deleted_at is null`
- `(company_id, so_date desc) where deleted_at is null`

RLS: `sales_orders_company_read` (any role) + `sales_orders_manager_write` (admin/manager only — sales team has manager role).

### `sales_order_lines`

Per-line items on a sales order.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `company_id` | `uuid` | not null, FK |
| `sales_order_id` | `uuid` | not null, FK → `sales_orders(id) on delete cascade` |
| `line_no` | `integer` | not null |
| `item_id` | `uuid` | nullable, FK → `items(id)` |
| `item_code_text` | `text` | nullable. Preserves legacy `itemCode` when item_id can't resolve |
| `part_name` | `text` | not null. Legacy `partName` |
| `material` | `text` | nullable |
| `drawing_no` | `text` | nullable |
| `uom` | `uom` | not null, default `'NOS'` |
| `order_qty` | `integer` | not null, check `> 0` |
| `rate` | `numeric(12,2)` | not null, default `0` |
| `due_date` | `date` | nullable |
| `client_po_line_no` | `text` | nullable |
| `status` | `so_status` | not null, default `'open'`. Per-line status (auto-closed when JCs satisfy line) |
| audit + `deleted_at` | (audit pattern) | |

Indexes:
- `unique (sales_order_id, line_no) where deleted_at is null`
- `(item_id) where deleted_at is null`
- `(company_id, status) where deleted_at is null`

RLS: same pattern as parent.

### `job_work_orders`

Header table for outsourced job work — customer supplies raw material, we manufacture.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `company_id` | `uuid` | not null, FK |
| `code` | `text` | not null. Business key (legacy `jwNo`, e.g. `JW-001`) |
| `jw_date` | `date` | not null |
| `client_id` | `uuid` | nullable, FK → `clients(id)`. Both current JWs have empty `clientId` — load null, use customer_name |
| `customer_name` | `text` | nullable. Fallback |
| `client_po_no` | `text` | nullable |
| `status` | `so_status` | not null, default `'open'` |
| `remarks` | `text` | nullable |
| audit + `deleted_at` | (audit pattern) | |

Indexes:
- `unique (company_id, code) where deleted_at is null`
- `(company_id, client_id) where deleted_at is null`
- `(company_id, status) where deleted_at is null`

RLS: same pattern as `sales_orders`.

### `job_work_order_lines`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `company_id` | `uuid` | not null, FK |
| `job_work_order_id` | `uuid` | not null, FK → `job_work_orders(id) on delete cascade` |
| `line_no` | `integer` | not null |
| `item_id` | `uuid` | nullable, FK → `items(id)` |
| `item_code_text` | `text` | nullable. Same fallback pattern as SO lines |
| `part_name` | `text` | not null |
| `material` | `text` | nullable |
| `drawing_no` | `text` | nullable |
| `uom` | `uom` | not null, default `'NOS'` |
| `order_qty` | `integer` | not null, check `> 0` |
| `due_date` | `date` | nullable |
| `client_material` | `text` | nullable. Raw material spec from client (e.g. `'SS 304 Round Bar 80mm'`) |
| `client_material_qty` | `numeric(12,2)` | nullable |
| `material_received_date` | `date` | nullable |
| `material_received_qty` | `numeric(12,2)` | nullable |
| `status` | `so_status` | not null, default `'open'` |
| audit + `deleted_at` | (audit pattern) | |

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
create type store_txn_source_type as enum ('grn_qc', 'manual_adjust', 'dispatch', 'jw_in', 'jw_out', 'other');
```

### `purchase_requests`

Bridges plan / op-entry → PO. Single-table (no separate lines) since current data is single-line per PR; promote to header+lines if multi-line PRs become a real workflow.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `company_id` | `uuid` | not null, FK |
| `code` | `text` | not null. Business key (legacy `prNo`, e.g. `PR-00001`) |
| `pr_date` | `date` | not null |
| `status` | `pr_status` | not null, default `'open'` |
| `vendor_id` | `uuid` | nullable, FK → `vendors(id)` |
| `vendor_code_text` | `text` | nullable. Free-text fallback when `vendor_id` can't resolve (ADR-012 #10 pattern). Legacy data uses `vendorCode='VND-001'` strings |
| `item_id` | `uuid` | nullable, FK → `items(id)` |
| `item_code_text` | `text` | nullable. Same fallback pattern |
| `item_name` | `text` | nullable. Snapshot at PR creation |
| `qty` | `integer` | not null, check `> 0` |
| `est_cost` | `numeric(12,2)` | not null, default `0` |
| `required_date` | `date` | nullable |
| `source_jc_op_id` | `uuid` | nullable, FK → `jc_ops(id) on delete set null`. Set when PR raised from outsource workflow |
| `source_so_line_id` | `uuid` | nullable, FK → `sales_order_lines(id) on delete set null`. Forward link for cost rollup; legacy carries `soRefId` on PR |
| `operation` | `text` | nullable. Snapshot for outsource PRs (legacy `operation='COATING'`) |
| `remarks` | `text` | nullable |
| `approved_by` | `uuid` | nullable, FK → `users(id)`. Null until status=approved |
| `approved_at` | `timestamptz` | nullable |
| `po_id` | `uuid` | nullable, FK → `purchase_orders(id) on delete set null`. Set when PO is generated from PR (legacy `prNo` → `poNo` link) |
| `po_created_at` | `timestamptz` | nullable |
| audit + `deleted_at` | (audit pattern) | |

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

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `company_id` | `uuid` | not null, FK |
| `code` | `text` | not null. Business key (legacy `poNo`, e.g. `IN-JWPO-00001`) |
| `po_date` | `date` | not null |
| `po_type` | `po_type` | not null, default `'standard'` |
| `vendor_id` | `uuid` | nullable, FK → `vendors(id)` |
| `vendor_code_text` | `text` | nullable. Fallback (legacy `vendorCode`) |
| `status` | `po_status` | not null, default `'draft'` |
| `due_date` | `date` | nullable. Header-level default; lines may override |
| `tax_type` | `text` | nullable. Legacy values: `'sgst_cgst'`, `'igst'`, `'none'`. Free-text for now; promote to enum if a third value emerges |
| `sgst_pct` | `numeric(5,2)` | not null, default `0` |
| `cgst_pct` | `numeric(5,2)` | not null, default `0` |
| `igst_pct` | `numeric(5,2)` | not null, default `0` |
| `pr_code_text` | `text` | nullable. Snapshot of legacy `prNo` for audit. Future: drop in favour of `purchase_requests.po_id` back-reference |
| `approved_by` | `uuid` | nullable, FK → `users(id)` |
| `approved_at` | `timestamptz` | nullable |
| `approval_remarks` | `text` | nullable |
| `remarks` | `text` | nullable |
| audit + `deleted_at` | (audit pattern) | |

Indexes:
- `unique (company_id, code) where deleted_at is null`
- `(company_id, vendor_id) where deleted_at is null`
- `(company_id, status) where deleted_at is null`
- `(company_id, po_date desc) where deleted_at is null`

RLS: same pattern as `purchase_requests`.

### `purchase_order_lines`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `company_id` | `uuid` | not null, FK |
| `purchase_order_id` | `uuid` | not null, FK → `purchase_orders(id) on delete cascade` |
| `line_no` | `integer` | not null |
| `item_id` | `uuid` | nullable, FK → `items(id)` |
| `item_code_text` | `text` | nullable. Fallback per ADR-012 #10 |
| `item_name` | `text` | not null. Snapshot at PO creation |
| `qty` | `integer` | not null, check `> 0` |
| `rate` | `numeric(12,2)` | not null, default `0` |
| `received_qty` | `integer` | not null, default `0`. Maintained by GRN cascade (T-035c+) |
| `due_date` | `date` | nullable |
| `source_so_line_id` | `uuid` | nullable, FK → `sales_order_lines(id) on delete set null`. Cost-rollup link; legacy carries `soRefId` on PO line |
| `source_jc_op_id` | `uuid` | nullable, FK → `jc_ops(id) on delete set null`. Outsource workflow link; replaces legacy `outsource_po_no` text on jc_ops |
| `line_remarks` | `text` | nullable |
| audit + `deleted_at` | (audit pattern) | |

Indexes:
- `unique (purchase_order_id, line_no) where deleted_at is null`
- `(item_id) where deleted_at is null`
- `(source_so_line_id) where source_so_line_id is not null`
- `(source_jc_op_id) where source_jc_op_id is not null`

CHECK: `received_qty >= 0` and `received_qty <= qty + (qty * 0.1)` — allow 10% over-receipt to handle legitimate vendor over-shipments without blocking GRN; tighten later if needed.

RLS: same pattern as parent.

### `goods_receipt_notes`

Header table for GRNs. Records material received against a PO. Current data: 3 lines all under one GRN.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `company_id` | `uuid` | not null, FK |
| `code` | `text` | not null. Business key (legacy `grnNo`, e.g. `IN-GRN-00001`) |
| `grn_date` | `date` | not null |
| `purchase_order_id` | `uuid` | nullable, FK → `purchase_orders(id) on delete set null`. Resolved from legacy `poNo` text on load |
| `po_code_text` | `text` | nullable. Audit snapshot |
| `vendor_id` | `uuid` | nullable, FK → `vendors(id)` |
| `vendor_code_text` | `text` | nullable. Fallback |
| `dc_no` | `text` | nullable. Vendor's DC reference |
| `invoice_no` | `text` | nullable |
| `remarks` | `text` | nullable |
| audit + `deleted_at` | (audit pattern) | |

Indexes:
- `unique (company_id, code) where deleted_at is null`
- `(company_id, purchase_order_id) where deleted_at is null`
- `(company_id, vendor_id) where deleted_at is null`
- `(company_id, grn_date desc) where deleted_at is null`

RLS: same pattern as `purchase_orders`.

### `goods_receipt_note_lines`

QC fields are inline per ADR-015 #8 — legacy data co-locates them on the GRN line.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `company_id` | `uuid` | not null, FK |
| `goods_receipt_note_id` | `uuid` | not null, FK → `goods_receipt_notes(id) on delete cascade` |
| `line_no` | `integer` | not null |
| `purchase_order_line_id` | `uuid` | nullable, FK → `purchase_order_lines(id) on delete set null`. Resolved by loader via `(po code, item code)` tuple; null + anomaly when not resolvable |
| `item_id` | `uuid` | nullable, FK → `items(id)` |
| `item_code_text` | `text` | nullable. Fallback |
| `item_name` | `text` | not null |
| `received_qty` | `integer` | not null, check `>= 0` |
| `dc_ref_no` | `text` | nullable. Per-line DC ref (legacy `dcRefNo` differs from header `dcNo` when split shipments) |
| `qc_status` | `grn_qc_status` | not null, default `'pending'` |
| `qc_accepted_qty` | `integer` | not null, default `0`, check `>= 0` |
| `qc_rejected_qty` | `integer` | not null, default `0`, check `>= 0` |
| `qc_date` | `date` | nullable |
| `qc_remarks` | `text` | nullable |
| `qc_inspected_by` | `uuid` | nullable, FK → `users(id)` |
| `remarks` | `text` | nullable |
| audit + `deleted_at` | (audit pattern) | |

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

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `company_id` | `uuid` | not null, FK |
| `txn_date` | `date` | not null |
| `item_id` | `uuid` | nullable, FK → `items(id)` |
| `item_code_text` | `text` | nullable. Fallback |
| `txn_type` | `store_txn_type` | not null. `in` / `out` / `adjust` |
| `qty` | `integer` | not null. Always positive — sign comes from `txn_type` |
| `source_type` | `store_txn_source_type` | not null. `grn_qc` / `manual_adjust` / `dispatch` / `jw_in` / `jw_out` / `other` |
| `source_ref` | `text` | not null. Polymorphic ref (e.g. `IN-GRN-00001`); FK columns added in later phases when types stabilise |
| `stock_before` | `integer` | not null. Snapshot at txn time (legacy carries this) |
| `stock_after` | `integer` | not null. = stock_before ± qty |
| `remarks` | `text` | nullable |
| audit (created_only) | (audit pattern) | created_by + created_at; no updated_*, no deleted_at |

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

### `jc_ops` — Phase 5 ALTERS

Per ADR-015 #5:
1. **Drop columns** `outsource_pr_no` (text) and `outsource_po_no` (text). Backfill before drop into the new FK columns below.
2. **Add columns:** `outsource_pr_id uuid nullable references purchase_requests(id) on delete set null` and `outsource_po_line_id uuid nullable references purchase_order_lines(id) on delete set null`.
3. **Add index** on each new FK column where non-null.
4. **Backfill** during T-035c load: for each jc_op with `outsource_pr_no` / `outsource_po_no` text, look up the corresponding new row by code → set the FK. Anomaly + null on miss (matching ADR-012 #10 fallback semantics; the text columns are dropped after backfill since the FK is the source of truth going forward).

`outsource_pr_id` is also referenced as the inverse of `purchase_requests.source_jc_op_id` — the two FKs co-exist for query convenience (PR → JC op when looking from procurement; JC op → PR when looking from shop floor). They MUST stay in sync (set both at PR creation; both null after PR cancellation). Service layer enforces — no DB CHECK because cross-table CHECKs are unwieldy in Postgres without triggers.

### Phase 5 Triggers

`before update` on each new table → `set_updated_at()`. No status-maintenance triggers in T-035b — auto-close PO header (when all lines fully received + QC complete) lives in the service layer (T-035c+) where it's testable.

### Phase 5 Action items (T-035b implementation)

- [ ] Drizzle schema in `apps/api/src/db/schema.ts` — 5 new tables + 6 new enums + `jc_ops` ALTER (drop 2 text cols, add 2 FK cols)
- [ ] Migration: `0010_phase5_procurement.sql` (drizzle-gen — tables + enums + FKs + indexes + RLS) + `0011_phase5_jc_ops_alters.sql` (hand-written — drop legacy text cols, add FK cols, add indexes) + `0012_phase5_triggers.sql` (set_updated_at on the 5 new tables) + `0013_phase5_views.sql` (v_item_stock)
- [ ] Apply via the existing `apply-sql.ts` runner for the hand-written migrations
- [ ] Update SCHEMA.md "Migration History" with the four migration filenames

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
| 2026-04-30 | `0002_tricky_fallen_one.sql` + `0003_phase2_triggers.sql` | Phase 2 storage layer — clients, vendors, machines, operators tables, indexes, RLS, BEFORE UPDATE triggers (T-014; 0003 hand-written, applied out-of-band) |
| 2026-05-01 | `0004_phase3_op_entry.sql` (drizzle-gen) + `0005_phase3_triggers.sql` (hand-written) + `0006_phase3_views.sql` (hand-written) | Phase 3 op-entry chain (T-024b) — 7 tables (route_cards, route_card_ops, route_card_revisions, job_cards, jc_ops, op_log, running_ops), 6 enums, BEFORE UPDATE triggers, derived-status views (`v_jc_op_status`, `v_jc_status` mirroring legacy calcEngine). Hand-written migrations applied via `apps/api/src/db/apply-sql.ts` |
| 2026-05-01 | `0007_phase4_sales_chain.sql` (drizzle-gen) + `0008_phase4_jc_alters.sql` (hand-written) + `0009_phase4_triggers.sql` (hand-written) | Phase 4 sales chain (T-029b) — 4 tables (sales_orders, sales_order_lines, job_work_orders, job_work_order_lines), 2 enums (so_type, so_status — shared between SO and JW), BEFORE UPDATE triggers. Plus job_cards alters: rename `source_jw_id`→`source_jw_line_id`, add 2 FKs (ON DELETE SET NULL), add CHECK `num_nonnulls(...) <= 1`. FK names initially custom; renamed in-place to Drizzle convention via one-shot SQL; snapshot patched to match. No drift on `drizzle-kit generate`. 73/73 api tests still green |
| 2026-05-02 | `0009_phase5_procurement.sql` (drizzle-gen) + `0010_phase5_triggers.sql` (hand-written) + `0011_phase5_views.sql` (hand-written) | Phase 5 procurement storage (T-035b) — 5 new tables (purchase_requests, purchase_orders, purchase_order_lines, goods_receipt_notes, goods_receipt_note_lines, store_transactions), 6 new enums (po_status, pr_status, po_type, grn_qc_status, store_txn_type, store_txn_source_type). Plus jc_ops adds 2 FK columns (outsource_pr_id → purchase_requests, outsource_po_line_id → purchase_order_lines) — legacy text columns (outsource_pr_no, outsource_po_no) kept until T-035c backfills then drops. BEFORE UPDATE triggers on the 5 new tables (store_transactions is append-only — no trigger). v_item_stock view aggregates per-item on-hand qty from store_transactions (ADR-015 #11). RLS: standard company-isolation + manager-write on all 5 tables; reserved goods_receipt_note_lines_qc_update policy for the QC role (no qc-role user yet — forward-defined for Phase 6). Applied via `apply-sql.ts` runner because the journal has an orphan `0008_verify_no_drift` entry from a stale run that breaks `drizzle-kit migrate`. No drift on `drizzle-kit generate`. 120/120 api tests still green |
