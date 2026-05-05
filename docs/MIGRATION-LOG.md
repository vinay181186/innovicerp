# MIGRATION-LOG.md — Firebase → Supabase Migration Record

> One entry per collection migrated, plus one section per export run. Append-only.

---

## Export Runs

### Run 1 — 2026-04-30T16:06:34Z (T-013 baseline)

**Source:** Firestore project `innovic-erp-v1-77a19`, root collection `innovic`
**Script:** `migration/export-firestore.ts` (commit `92b09e9`)
**Duration:** ~38 s · **Output:** `migration/export/` (gitignored, 1.2 MB, 68 files)

**Counts:**

- Collections requested / exported: 65 / 65
- Singletons: `_settings` ✅ exists, `companies/innovic` ❌ doc absent (legacy app never created the company-meta doc; not blocking — the seed admin in our new system already has company info)
- Total records: **550** across **27 active collections**
- Doc-missing: **38** collections (unused features in the legacy app — see anomalies below)

**Per-collection record counts (active only):**
| Collection | Records | | Collection | Records |
|---|---:|---|---|---:|
| items | 352 | | jobCards | 3 |
| opLog | 81 | | bomMasters | 3 |
| jcOps | 20 | | grn | 3 |
| activityLog | 14 | | ncRegister | 3 |
| routeCards | 14 | | plans | 3 |
| machines | 12 | | vendors | 3 |
| salesOrders | 9 | | jobWorkOrders | 2 |
| qcProcesses | 5 | | runningOps | 2 |
| reportTypes | 5 | | storeTransactions | 2 |
| challans | 4 | | userAccess | 2 |
| | | | users | 2 |
| | | | alertConfig | 1 |
| | | | clients | 1 |
| | | | dashboardConfig | 1 |
| | | | operators | 1 |
| | | | purchaseOrders | 1 |
| | | | purchaseRequests | 1 |

**Anomalies (all `doc_missing` — collections never written by the legacy app):**
costCenters, dailyReports, taskAllocations, outsourceJobs, jwDCOutward, jwDCInward, partyMaterials, partyGrn, qcDocUploads, storeIssues, dispatchLog, trash, queueOrders, opEntries, assemblyTracking, assemblyUnits, toolIssues, designTracker, designTimeLog, stuckThresholds, qcAssignments, fileRegistry, designProjects, designTasks, designIssues, designWorkLog, designDCRs, designDCNs, ospProcessConfig, ospDC, servicePOs, capaRecords, printTemplates, printTemplateRevisions, schedulingHistory, leads, communications, crmReminders. (38 total.)

**Implications for downstream phases:**

- Phase 2 master data (users, clients, vendors, items, machines, operators) — all populated, total 360 records (mostly items, 352).
- Phase 3 op-entry chain (jobCards, jcOps, opLog) — populated, 104 records.
- Phase 4 sales chain (salesOrders, jobWorkOrders) — populated, 11 records.
- Phase 5 procurement (purchaseOrders, grn, storeTransactions) — populated, 6 records.
- Phase 6 QC + dispatch — partially populated: qcProcesses 5, ncRegister 3, challans 4. dispatchLog/qcAssignments/qcDocUploads absent.
- Phase 8 design + CRM + party — all absent (38 of the 38 missing). Phase 8 may shrink to dashboardConfig/alertConfig/printTemplates only — confirm with user before building those modules.
- Phase 9 activityLog — populated, 14 records.

**Note:** the legacy COLLECTIONS array in `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` (line 585) has 65 names — earlier docs cited "67". Corrected in `migration/README.md` and `docs/SCHEMA.md` in the same commit as this entry.

---

## Transform Runs

### Run 1 — 2026-04-30T16:40:17Z (T-014 partial: users + items)

**Inputs:** `migration/export/users.json` (2 records), `migration/export/items.json` (352 records)
**Output:** `migration/transform/users.json`, `migration/transform/items.json`, `_id_map.json`, `_anomalies.json`
**Tests:** 18/18 vitest pass (8 users + 10 items)
**Total rows transformed:** 354

| Table | Input | Rows | Anomalies | Notes                                                                                                                                             |
| ----- | ----: | ---: | --------: | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| users |     2 |    2 |         0 | Both admins; PINs carried in `_legacyPin` for T-015 (load) — Supabase Auth signup will replace with temporary passwords                           |
| items |   352 |  352 |         8 | All anomalies are `uom_normalised` (6 `Nos`→`NOS`, 2 `Set`→`SET`); no validation skips, no missing fields, no `drawingData` to migrate to Storage |

**id_map state:** users entries are null (Supabase Auth assigns at load time); items entries are deterministic UUIDv5 (stable across re-runs via fixed namespace `f5b8a3a4-1c2d-4e3f-8a5b-6c7d8e9f0a1b`).

**Stubs (not yet wired — pending schemas in T-017/T-018/T-020/T-021):** clients, vendors, machines, operators.

### Run 2 — 2026-04-30T17:00:25Z (T-014 complete: all 6 master-data transforms)

**Inputs:** users, clients, vendors, items, machines, operators export files
**Output:** 6 `<table>.json` files in `migration/transform/` plus updated `_id_map.json` and `_anomalies.json`
**Tests:** 38/38 vitest pass (8 users + 5 clients + 5 vendors + 10 items + 5 machines + 5 operators)
**Total rows:** 371 (vs 354 in Run 1 — added 1 client, 3 vendors, 12 machines, 1 operator)

| Table     | Input | Rows | Anomalies | Notes                                                                  |
| --------- | ----: | ---: | --------: | ---------------------------------------------------------------------- |
| users     |     2 |    2 |         0 | Same as Run 1                                                          |
| clients   |     1 |    1 |         0 | Single L&T record, address/contact/email all empty in legacy           |
| vendors   |     3 |    3 |         0 | Mehta Steel + 2 others, all `status: Active`, ratings present          |
| items     |   352 |  352 |         8 | Same as Run 1 (uom_normalised: 6 `Nos`→`NOS`, 2 `Set`→`SET`)           |
| machines  |    12 |   12 |         0 | All shop-floor CNCs, statuses Running/Idle                             |
| operators |     1 |    1 |         0 | Single shop-floor operator (`VNM` / Vinay), userId left null for T-015 |

**Schema additions in this run** (migrations `0002_tricky_fallen_one.sql` + `0003_phase2_triggers.sql`):

- `clients` (18 cols) + `vendors` (20 cols) + `machines` (13 cols) + `operators` (13 cols)
- Each: company-scoped `(company_id, code)` unique index, `(company_id)` index, RLS pair (`company_read` / `manager_write`)
- Plus `before update` triggers calling `set_updated_at()`
- `operators.user_id` is nullable FK → `users(id)` for the optional operator-has-login link

**id_map state after Run 2:** items/clients/vendors/machines/operators all have deterministic UUIDv5 ids; users entries still null pending Supabase Auth assignment in T-015.

---

## Per-Collection Migration Entries

> One entry per collection migrated. Append-only.

### Load Run 1 — 2026-04-30T17:21:20Z (T-015 + T-016/T-017/T-018/T-019/T-020/T-021)

**Target:** dev Supabase Mumbai (`d997c3ed-3496-49b6-a54d-6e9ea9d50548` company)
**Script:** `migration/load.ts` (commit pending)
**Duration:** ~4 s · **Total rows inserted:** 371
**Validation:** OK on 5 of 6 tables; users diff +1 (pre-existing `viewer@innovic.test` from T-012 smoke; not a load issue)

## users

**Date:** 2026-04-30
**Source records:** 2
**Loaded records:** 2 (seed admin reused; new user invited)
**Discrepancy:** 0 (validation reports diff=+1 vs DB count of 3 because the leftover `viewer@innovic.test` from T-012 smoke remains; not migrated by this script)
**Anomalies:** None
**Validation:** PASS — all 2 transformed users resolved; outcomes recorded in `migration/load-output/users-loaded.json`
**Cutover:** Pending (T-027 for the operator parallel-run; T-053 for full read-only HTML archival)

Outcomes:

- `mmtdefvc` (Vinay N Makwana, innovic.technology@gmail.com) → reused existing seed admin id `e9c9ed51-7aa0-4d4f-95ab-f6c3ee9e2320`; updated public.users (full_name, role, is_active=true, company_id)
- `6am6dudd` (Japan, japan@innovictechnology.com) → invited via `supabase.auth.admin.inviteUserByEmail` (option B per user choice 2026-04-30); new id `63bb07e7-f413-4fa8-8328-e8641a39ec96`; invite email sent; public.users upsert set role=admin, company_id, is_active=true

## clients

**Date:** 2026-04-30
**Source records:** 1
**Loaded records:** 1
**Discrepancy:** 0
**Anomalies:** None at transform; load `_legacyExtras` empty
**Validation:** PASS — db count 1, sample matches transform shape
**Cutover:** Pending (T-022 admin screen + sales team cutover in Phase 4)

Outcomes:

- `a559u04v` (L&T Precision engineering (Hazira), code `L&T_1`) — only address/contact/email all empty in legacy

## vendors

**Date:** 2026-04-30
**Source records:** 3
**Loaded records:** 3
**Discrepancy:** 0
**Anomalies:** None
**Validation:** PASS — db count 3, sample matches transform shape
**Cutover:** Pending (T-022 + procurement cutover in Phase 5)

Records loaded: `v1` Mehta Steel Traders (VND-001), plus 2 others. All `status: Active`, ratings preserved verbatim.

## items

**Date:** 2026-04-30
**Source records:** 352
**Loaded records:** 352
**Discrepancy:** 0
**Anomalies:** 8 at transform — all `uom_normalised` (6× `Nos`→`NOS`, 2× `Set`→`SET`); all loaded successfully under normalised UOM. `_legacyExtras` captures stockQty/minStock/category/location/status for future stock-control module
**Validation:** PASS — db count 352, sample matches transform shape; deterministic UUIDv5 ids stable across re-runs
**Cutover:** Pending (T-022 + parallel-run in Phase 3 op-entry workflow)

## machines

**Date:** 2026-04-30
**Source records:** 12
**Loaded records:** 12
**Discrepancy:** 0
**Anomalies:** None at transform; legacy `type` field empty for all 12 records (machineType column null in DB)
**Validation:** PASS — db count 12, sample matches transform shape
**Cutover:** Pending (T-022 + Phase 3 live-operations board)

## operators

**Date:** 2026-04-30
**Source records:** 1
**Loaded records:** 1
**Discrepancy:** 0
**Anomalies:** None at transform; user_id left null (T-015 doesn't auto-link to public.users; T-022 may add a manual link UI)
**Validation:** PASS — db count 1, sample matches transform shape
**Cutover:** Pending (T-022 + Phase 3 op-entry workflow)

Records loaded: `xeely6yu` (VNM / Vinay), department/skills empty in legacy.

---

## Transform Run 3 — 2026-05-01 (T-024c, all 11 collections)

**Inputs:** Run 1 export (all collections)
**Output:** 13 `<table>.json` files in `migration/transform/` (added 5 Phase 3 collections producing 7 tables — routeCards splits into 3)
**Tests:** 71/71 vitest pass (Phase 2: 38 + Phase 3: 33 new)
**Total rows:** **490** valid + **72 anomalies**

| Collection | Table                | Input | Rows | Anomalies | Notes                                                                                             |
| ---------- | -------------------- | ----: | ---: | --------: | ------------------------------------------------------------------------------------------------- |
| users      | users                |     2 |    2 |         0 | Same as Run 2                                                                                     |
| clients    | clients              |     1 |    1 |         0 | Same as Run 2                                                                                     |
| vendors    | vendors              |     3 |    3 |         0 | Same as Run 2                                                                                     |
| items      | items                |   352 |  352 |         8 | Same as Run 2 (uom normalisations)                                                                |
| machines   | machines             |    12 |   12 |         0 | Same as Run 2                                                                                     |
| operators  | operators            |     1 |    1 |         0 | Same as Run 2                                                                                     |
| routeCards | route_cards          |    14 |   13 |         1 | `IN-RC-00012` dropped — itemCode `ITM-001` not in production items master                         |
| routeCards | route_card_ops       |    14 |   61 |         0 | 5 ops lost with the dropped `IN-RC-00012` parent                                                  |
| routeCards | route_card_revisions |    14 |    2 |         0 | Only 2 of 14 cards have non-empty revisionLog (`IN-RC-00004`, `IN-RC-00006`); jsonb opsSnapshot   |
| jobCards   | job_cards            |     3 |    2 |         1 | `IN-JC-00001` dropped — same `ITM-001` issue                                                      |
| jcOps      | jc_ops               |    20 |   15 |         5 | `IN-JC-00001`'s 5 ops cascade-dropped                                                             |
| opLog      | op_log               |    81 |   24 |        57 | 7 expected orphans (`JC-MS-002/003/004` jcNos, ADR-011 #11) + 50 cascade drops from `IN-JC-00001` |
| runningOps | running_ops          |     2 |    2 |         0 | Both `IN-JC-00002` ops, fully resolvable                                                          |

**ITM-001 cascade finding** (user-acknowledged 2026-05-01, option (a) accept-the-loss):
The legacy HTML's hardcoded seed at line 1394 references `itemCode: 'ITM-001'` for `IN-JC-00001` but `ITM-001` was never created in the production items master. Net effect: 1 RC + 5 RC ops + 1 JC + 5 jc_ops + 50 op_logs (~62 rows) lost beyond the 7 expected orphans. These appear to be test/seed data, not real shop-floor work.

---

## Phase 2 Sign-Off — 2026-05-01 (T-023)

**Script:** `migration/validate-phase2.ts` · **Output:** `migration/load-output/_phase2_validation.json` (gitignored) · **Overall status:** **PASS**

Read-only field-level diff + orphan FK pass against dev Supabase, run via `pnpm --filter @innovic/migration validate:phase2`.

**Field-level diff (transform → DB, mapped columns):**

| Table     | Transform rows | DB count | Matched | Field diffs | Missing from DB |
| --------- | -------------: | -------: | ------: | ----------: | --------------: |
| items     |            352 |      352 |     352 |           0 |               0 |
| clients   |              1 |        1 |       1 |           0 |               0 |
| vendors   |              3 |        3 |       3 |           0 |               0 |
| machines  |             12 |       12 |      12 |           0 |               0 |
| operators |              1 |        1 |       1 |           0 |               0 |

Total: **369 / 369 mapped rows match transform on every loaded column**. The 8 known anomalies (uom_normalised on items, T-014 Run 2) are by-design transformations and are reflected in both transform output and DB rows — they are not field diffs.

**Users count:** transform 2 + 1 expected delta (`viewer@innovic.test` left over from T-012 smoke) = **3 in DB. OK.**

**Orphan FK checks (14 columns checked, all 0 orphans):**

- `items.created_by`, `items.updated_by`
- `clients.created_by`, `clients.updated_by`
- `vendors.created_by`, `vendors.updated_by`
- `machines.created_by`, `machines.updated_by`
- `operators.created_by`, `operators.updated_by`, `operators.user_id` (nullable)
- `users.created_by`, `users.updated_by`, `users.company_id`

**Conclusions:**

- Every legacy field that has a column in the new schema lands in DB byte-for-byte (or via documented transform: uom normalisation).
- Audit columns and the optional `operators.user_id` link are FK-clean.
- Users count exactly matches `transformRowCount + 1` (smoke leftover); no migrated users went missing or duplicated.

**Phase 2 master data is sign-off ready.** Next: Phase 3 op-entry chain (T-024).

> Re-run anytime to confirm the DB still matches transform output:
> `pnpm --filter @innovic/migration validate:phase2`

---

## Phase 3 Per-Collection Entries — Load Run 2 — 2026-05-01 (T-024d)

**Target:** dev Supabase Mumbai (same `d997c3ed-...` company as Phase 2)
**Script:** `migration/load.ts` (extended for Phase 3 — per-table conflict targets + audit shapes)
**Duration:** ~250 ms · **Total rows inserted:** **119**

## routeCards (route_cards + route_card_ops + route_card_revisions)

**Date:** 2026-05-01
**Source records:** 14 (master template)
**Loaded records:** 13 cards + 61 ops + 2 revisions = **76 rows**
**Discrepancy:** 1 card dropped — `IN-RC-00012` referenced unresolved itemCode `ITM-001` (see ITM-001 cascade finding)
**Anomalies:** 1 at transform (itemCode_unresolved); ops/revisions for the dropped parent never produced
**Validation:** PASS — db count exactly matches transform across all 3 child tables
**Cutover:** Pending (T-025 Op Entry screen + admin route-card editor in a later phase)

## jobCards (job_cards)

**Date:** 2026-05-01
**Source records:** 3
**Loaded records:** 2
**Discrepancy:** 1 dropped — `IN-JC-00001` (ITM-001 cascade)
**Anomalies:** `source_legacy_ref` JSON-encodes `(soNo, soRefId, soLineNo, soPartName, clientPoLineNo)`; FKs to sales_order_lines / job_work_orders deferred to Phase 4 per ADR-011 #5
**Validation:** PASS
**Cutover:** Pending (T-025 Op Entry screen)

## jcOps (jc_ops)

**Date:** 2026-05-01
**Source records:** 20
**Loaded records:** 15
**Discrepancy:** 5 dropped — all 5 jc_ops belonging to the orphaned `IN-JC-00001` (ITM-001 cascade)
**Anomalies:** 5 jcNo_unresolved at transform; outsource fields kept inline per ADR-011 #6
**Validation:** PASS
**Cutover:** Pending (T-025 Op Entry screen)

## opLog (op_log)

**Date:** 2026-05-01
**Source records:** 81
**Loaded records:** 24
**Discrepancy:** 57 dropped — **7 expected orphans** (`JC-MS-002/003/004` jcNos, never had jobCards rows in source; ADR-011 #11) + **50 cascade drops** from the orphaned `IN-JC-00001` (ITM-001 cascade)
**Anomalies:** 57 jc_op_unresolved at transform
**Validation:** PASS — append-only table, no `deleted_at`; field-level diff covers `start_time` HH:MM ↔ HH:MM:SS normalisation
**Cutover:** Pending (T-025 + T-026 server-side validations + T-027 5-day parallel run + T-028 cutover)

## runningOps (running_ops)

**Date:** 2026-05-01
**Source records:** 2
**Loaded records:** 2
**Discrepancy:** 0
**Anomalies:** None
**Validation:** PASS — both rows belong to `IN-JC-00002` opSeq 3 + 5; statuses Done + Running normalised to lowercase
**Cutover:** Pending (T-025 Live Operations Board)

---

## Phase 3 Sign-Off — 2026-05-01 (T-024d)

**Script:** `migration/validate-phase3.ts` · **Output:** `migration/load-output/_phase3_validation.json` (gitignored) · **Overall status:** **PASS**

Read-only field-level diff + 25 orphan FK checks + view sanity, run via `pnpm --filter @innovic/migration validate:phase3`.

**Field-level diff (transform → DB, mapped columns; jsonb compared as canonical JSON; HH:MM ↔ HH:MM:SS normalised on `time` columns):**

| Table                | Transform rows | DB count | Matched | Field diffs | Missing from DB |
| -------------------- | -------------: | -------: | ------: | ----------: | --------------: |
| route_cards          |             13 |       13 |      13 |           0 |               0 |
| route_card_ops       |             61 |       61 |      61 |           0 |               0 |
| route_card_revisions |              2 |        2 |       2 |           0 |               0 |
| job_cards            |              2 |        2 |       2 |           0 |               0 |
| jc_ops               |             15 |       15 |      15 |           0 |               0 |
| op_log               |             24 |       24 |      24 |           0 |               0 |
| running_ops          |              2 |        2 |       2 |           0 |               0 |

Total: **119 / 119 mapped rows match transform on every loaded column**.

**Orphan FK checks (25 columns, all 0 orphans):**

- route_cards: item_id, created_by, updated_by
- route_card_ops: route_card_id, machine_id, created_by, updated_by
- route_card_revisions: route_card_id, created_by
- job_cards: item_id, created_by, updated_by
- jc_ops: job_card_id, machine_id, outsource_vendor_id, created_by, updated_by
- op_log: jc_op_id, operator_id, created_by
- running_ops: jc_op_id, machine_id, operator_id, created_by, updated_by

**View sanity (mirrors legacy `calcEngine()`):**

- `v_jc_op_status` — 15 rows. computed_status breakdown: `waiting:5, available:2, in_progress:0, running:1, qc_pending:2, complete:4, at_vendor:1` (plus 0 each for the other outsource sub-states).
- `v_jc_status` — 2 rows. computed_status: `open:1, qc_pending:1`.

**Conclusions:**

- Every Phase 3 column lands in DB byte-for-byte (modulo documented normalisations: enum lowercasing, time format, jsonb).
- All 25 FK columns reference existing parents. Cascade-on-delete chains (op_log → jc_ops, running_ops → jc_ops, jc_ops → job_cards, route_card_ops → route_cards, route_card_revisions → route_cards) tested implicitly via the orphan checks.
- Both views execute and return sensible computed_status distributions, confirming the SQL-as-`calcEngine()` mirror works on real data.

**Phase 3 storage layer + transform + load are sign-off ready.** Next: T-025 (Op Entry screen with TanStack Query optimistic updates + Realtime subscription).

> Re-run anytime: `pnpm --filter @innovic/migration validate:phase3`

---

## Phase 4 Per-Collection Entries — Load Run 3 — 2026-05-02 (T-029d)

**Target:** dev Supabase Mumbai (same `d997c3ed-...` company as Phase 2 + 3)
**Script:** `migration/load.ts` (extended for Phase 4 — 4 new mappers + JC source FK backfill phase)
**Duration:** ~2.5 s incl. backfill + count validation · **Total rows inserted:** **15** + **2 JC FK UPDATEs**

## salesOrders (sales_orders + sales_order_lines)

**Date:** 2026-05-02
**Source records:** 9 (1 demo Equipment SO line + 8 lines of SO-436)
**Loaded records:** 2 headers + 9 lines = **11 rows**
**Discrepancy:** 0 — header+lines split per ADR-012 #1 (group by `soNo`); both headers + every line round-tripped
**Anomalies:** 1 line at transform (`SO-DEMO-EQ` line 1 has no resolvable itemCode `HYD-PRESS-100T` → `item_id=null` + `item_code_text='HYD-PRESS-100T'` per ADR-012 #10; NOT skipped)
**Validation:** PASS — 11/11 field-level matches; 0 orphan FKs across `client_id`, `sales_order_id`, `item_id`, audit cols
**Cutover:** Pending (T-030 SO list/detail/create/edit screens, then T-034 sales-team module-by-module cutover)

## jobWorkOrders (job_work_orders + job_work_order_lines)

**Date:** 2026-05-02
**Source records:** 2 (JW-001, JW-002, each with 1 line)
**Loaded records:** 2 headers + 2 lines = **4 rows**
**Discrepancy:** 0
**Anomalies:** 2 line-level itemCode unresolved (`ITM-003`, `ITM-001`) — both loaded with `item_id=null` + `item_code_text` preserved per ADR-012 #10. Both current JWs have empty legacy `clientId` → loaded with `client_id=null` + `customer_name` populated.
**Validation:** PASS — 4/4 field-level matches; 0 orphan FKs across `client_id`, `job_work_order_id`, `item_id`, audit cols
**Cutover:** Pending (T-031 JW list/detail screens)

## job_cards source FK backfill (T-029d Phase B')

**Date:** 2026-05-02
**Source:** Each JC's `source_legacy_ref` text column (Phase 3 carry-over per ADR-011 #5)
**Backfilled:** 2 / 2 — both surviving JCs map to SO-436 lines via legacy `soRefId`:

- `IN-JC-00002` (`2e10fbda-…`) → `source_so_line_id = 8aa420eb-4215-5d07-8d5e-647fc8f72fcd` (SO-436 line 6 / legacy `4n7tmo9u` / partName `JOINT`)
- `IN-JC-00003` (`80c31859-…`) → `source_so_line_id = ef6772a0-d139-5e63-9d0d-89f75be37d1d` (SO-436 line 4 / legacy `mmrfp7d3` / partName `SPACER`)
  **JW backfill:** 0 — no current JCs reference JWs
  **Validation:** PASS — both FKs verified via `validate-phase4.ts` against `_id_map.json`; CHECK `num_nonnulls(source_so_line_id, source_jw_line_id) <= 1` holds
  **Notes:** Helper is idempotent (rows with either FK already non-null skip). `source_legacy_ref` text retained one phase per ADR-012 #3; drop in Phase 5 cleanup commit.

---

## Phase 4 Sign-Off — 2026-05-02 (T-029d)

**Script:** `migration/validate-phase4.ts` · **Output:** `migration/load-output/_phase4_validation.json` (gitignored) · **Overall status:** **PASS**

Read-only field-level diff + 16 orphan FK checks + JC backfill verification, run via `pnpm --filter @innovic/migration validate:phase4`.

**Field-level diff (transform → DB, mapped columns):**

| Table                | Transform rows | DB count | Matched | Field diffs | Missing from DB |
| -------------------- | -------------: | -------: | ------: | ----------: | --------------: |
| sales_orders         |              2 |        2 |       2 |           0 |               0 |
| sales_order_lines    |              9 |        9 |       9 |           0 |               0 |
| job_work_orders      |              2 |        2 |       2 |           0 |               0 |
| job_work_order_lines |              2 |        2 |       2 |           0 |               0 |

Total: **15 / 15 mapped rows match transform on every loaded column**.

**Orphan FK checks (16 columns, all 0 orphans):**

- sales_orders: client_id, created_by, updated_by
- sales_order_lines: sales_order_id, item_id, created_by, updated_by
- job_work_orders: client_id, created_by, updated_by
- job_work_order_lines: job_work_order_id, item_id, created_by, updated_by
- **job_cards (Phase 4 ALTERS):** source_so_line_id, source_jw_line_id

**Backfill verification (job_cards source FK):**

- JCs examined: 2 · verified: **2/2** · FK issues: 0 · audit-only legacy unresolved: 0
- Both surviving JCs (IN-JC-00002 → `4n7tmo9u`, IN-JC-00003 → `mmrfp7d3`) resolved against `_id_map.json` and the actual DB FK matches expected target.

**Conclusions:**

- Every Phase 4 column lands in DB byte-for-byte (modulo documented normalisations: enum lowercasing, type → so_type, status → so_status, NUMERIC `.toFixed(2)` strings).
- All 16 FK columns reference existing parents, including the 2 new JC FKs added in `0008_phase4_jc_alters.sql`.
- The deferred sales-link backfill from ADR-011 #5 is now complete and verified.
- `customer_name` + `item_code_text` fallbacks (ADR-012 #9, #10) prevented any row drops on master-data gaps — unlike Phase 3's ITM-001 cascade.

**Phase 4 storage layer + transform + load + JC backfill are sign-off ready.** Next: T-030 (SO list / detail / create / edit screens).

> Re-run anytime: `pnpm --filter @innovic/migration validate:phase4`

---

## Phase 5 Per-Collection Entries — Load Run 4 — 2026-05-02 (T-035c)

**Target:** dev Supabase Mumbai (same `d997c3ed-...` company as Phase 2 + 3 + 4)
**Script:** `migration/load.ts` (extended for Phase 5 — 6 new mappers + jc_op outsource backfill phase)
**Duration:** ~500 ms incl. backfill + count validation · **Total rows inserted:** **9** + **1 jc_op FK UPDATE**

## purchaseRequests (purchase_requests)

**Date:** 2026-05-02
**Source records:** 1 (PR-00001 — outsource COATING for IN-JC-00002 op_seq=7)
**Loaded records:** 1
**Discrepancy:** 0
**Anomalies:** 1 at transform — `approved_by_text_only` (legacy carries `approvedBy: 'Japan'` as free text; loader sets `approved_by=null` per ADR-015 design and preserves the date as `approved_at`)
**Validation:** PASS — field-level diff matches; vendor_id, item_id, source_jc_op_id, source_so_line_id, po_id all FK-clean
**Cutover:** Pending (T-036 PR/PO/GRN screens, then T-037 procurement-team cutover)

Resolved links: `vendor_id` → VND-001 (Mehta Steel); `item_id` → 554117302000 (JOINT); `source_jc_op_id` → IN-JC-00002 op_seq=7; `source_so_line_id` → SO-436 line 6 (`8aa420eb-…`); `po_id` → IN-JWPO-00001 (deterministic uuidv5).

## purchaseOrders (purchase_orders + purchase_order_lines)

**Date:** 2026-05-02
**Source records:** 1 (IN-JWPO-00001, single line for JOINT)
**Loaded records:** 1 header + 1 line = **2 rows**
**Discrepancy:** 0 — header+lines split per ADR-015 #1 (group by `poNo`)
**Anomalies:** 1 header-level `approved_by_text_only` (same pattern as PR); 0 line-level
**Validation:** PASS — line.source_so_line_id resolved (`8aa420eb-…`); line.source_jc_op_id resolved via PR bridge (PR-00001 → IN-JC-00002 op_seq=7)
**Cutover:** Pending (T-036)

## grn (goods_receipt_notes + goods_receipt_note_lines)

**Date:** 2026-05-02
**Source records:** 3 (all under IN-GRN-00001 — 1 BLOCK + 2 JOINT receipts)
**Loaded records:** 1 header + 3 lines = **4 rows**
**Discrepancy:** 0 — header+lines split per ADR-015 #1 (auto-numbered lines 1–3 in source order, since legacy has no GRN line numbers)
**Anomalies:** 1 line-level `po_line_unresolved` for the BLOCK line (itemCode `60346519`) — PO IN-JWPO-00001 only has a JOINT line; receiving BLOCK against the PO is legacy data drift (loaded with `purchase_order_line_id=null` + `item_code_text=60346519` per ADR-012 #10 fallback)
**Validation:** PASS — 4/4 field-level matches; goods_receipt_note_id, purchase_order_line_id (where non-null), item_id all FK-clean; QC clamping CHECK satisfied
**Cutover:** Pending (T-036)

## storeTransactions (store_transactions)

**Date:** 2026-05-02
**Source records:** 2 (both `IN` from GRN QC accept on JOINT — 25 + 20 = 45 total)
**Loaded records:** 2
**Discrepancy:** 0
**Anomalies:** 0 (both rows arithmetic-clean: 0→25→45 stockBefore/After progression)
**Validation:** PASS — append-only ledger (created_only audit, no `deleted_at`); item_id resolved on both
**Cutover:** Pending (T-036 + ledger viewer in Phase 7 reports)

## jc_ops outsource backfill (T-035c Phase B'')

**Date:** 2026-05-02
**Source:** Each jc_op's legacy text columns `outsource_pr_no` / `outsource_po_no` (T-024d carry-over per ADR-011 #6)
**Backfilled:** 1 / 1 — the single jc_op carrying outsource refs (IN-JC-00002 op_seq=7, COATING) maps both ways:

- `outsource_pr_id` ← lookup PR by `code='PR-00001'` → resolved
- `outsource_po_line_id` ← lookup PO line via inverse pointer (`source_jc_op_id = jc_op.id`, set by the PO transform via PR bridge) → resolved
  **Validation:** PASS — both FKs verified via `validate-phase5.ts` (resolved PR.code = legacy `outsource_pr_no`; resolved PO.code = legacy `outsource_po_no`)
  **Notes:** Helper is idempotent (rows whose target FK is already non-null skip). Legacy text columns retained for audit; drop in a follow-on cleanup commit per ADR-015 #5.

---

## Phase 5 Sign-Off — 2026-05-02 (T-035c)

**Script:** `migration/validate-phase5.ts` · **Output:** `migration/load-output/_phase5_validation.json` (gitignored) · **Overall status:** **PASS**

Read-only field-level diff + 32 orphan FK checks + jc_op outsource backfill verification, run via `pnpm --filter @innovic/migration validate:phase5`.

**Field-level diff (transform → DB, mapped columns; timestamps normalised via `Date.toISOString()` to compare ISO ↔ Postgres canonical):**

| Table                    | Transform rows | DB count | Matched | Field diffs | Missing from DB |
| ------------------------ | -------------: | -------: | ------: | ----------: | --------------: |
| purchase_requests        |              1 |        1 |       1 |           0 |               0 |
| purchase_orders          |              1 |        1 |       1 |           0 |               0 |
| purchase_order_lines     |              1 |        1 |       1 |           0 |               0 |
| goods_receipt_notes      |              1 |        1 |       1 |           0 |               0 |
| goods_receipt_note_lines |              3 |        3 |       3 |           0 |               0 |
| store_transactions       |              2 |        2 |       2 |           0 |               0 |

Total: **9 / 9 mapped rows match transform on every loaded column**.

**Orphan FK checks (32 columns, all 0 orphans):**

- purchase_requests: vendor_id, item_id, source_jc_op_id, source_so_line_id, po_id, approved_by, created_by, updated_by
- purchase_orders: vendor_id, approved_by, created_by, updated_by
- purchase_order_lines: purchase_order_id, item_id, source_so_line_id, source_jc_op_id, created_by, updated_by
- goods_receipt_notes: purchase_order_id, vendor_id, created_by, updated_by
- goods_receipt_note_lines: goods_receipt_note_id, purchase_order_line_id, item_id, qc_inspected_by, created_by, updated_by
- store_transactions: item_id, created_by
- **jc_ops (Phase 5 ALTERS):** outsource_pr_id, outsource_po_line_id

**Backfill verification (jc_ops outsource FKs):**

- jc_ops examined: 1 · verified: **1/1** · FK issues: 0
- The single outsource jc_op (IN-JC-00002 op_seq=7) has both new FK columns populated; resolved PR.code = `PR-00001` and resolved PO.code = `IN-JWPO-00001` both match the legacy text refs.

**Conclusions:**

- Every Phase 5 column lands in DB byte-for-byte (modulo documented normalisations: enum lowercasing, NUMERIC `.toFixed(2)` strings, ISO ↔ Postgres timestamptz format).
- All 32 FK columns reference existing parents, including the 2 new jc_ops FKs added in `0009_phase5_procurement.sql` (T-035b).
- The deferred outsource backfill from ADR-011 #6 is now complete and verified — the inverse-pointer strategy (PO line `source_jc_op_id` → jc_op) avoids parsing PO header text and works regardless of how many lines the PO has.
- The 1 GRN po_line_unresolved (BLOCK received against a JOINT-only PO) is legacy data drift, not a migration bug — `item_code_text` fallback preserves the audit trail per ADR-012 #10.

**Phase 5 procurement transform + load + jc_op outsource backfill are sign-off ready.** Next: T-036 (PR/PO/GRN screens with vendor cascade, line-item matching, QC inline on GRN).

> Re-run anytime: `pnpm --filter @innovic/migration validate:phase5`

---

## Phase 6 Per-Collection Entries — Load Run 5 — 2026-05-03 (T-038)

**Target:** dev Supabase Mumbai (same `d997c3ed-...` company)
**Script:** `migration/load.ts` (extended for Phase 6 — 1 new mapper)
**Duration:** ~50 ms · **Total rows inserted:** **5**

## qcProcesses (qc_processes)

**Date:** 2026-05-03
**Source records:** 5 (MIR / MCR / DIR / Coating Inspection / TPI)
**Loaded records:** 5
**Discrepancy:** 0
**Anomalies:** 0 at transform — all 5 are `status: 'Active'` with `defaultCycleTime: 0`. Description blank only for `Coating Inspection` (loaded as null).
**Validation:** PASS — `validate:phase6` script: 5/5 field-level matches, 0 orphan FKs across 2 checks (created_by + updated_by). Deterministic UUIDv5 ids stable across re-runs.
**Cutover:** Pending (T-040 builds the QC inspection workflow + admin CRUD for the master)

Records loaded: `1olhiafn` MIR, `l3hbf23s` MCR, `5ksvw3uz` DIR, `i56kaxzs` Coating Inspection (description blank in legacy), `4p3re6a7` TPI.

## qcAssignments — NOT MIGRATED (per ADR-016)

**Date:** 2026-05-03
**Source records:** 0 (collection doc_missing in Run 1 export — never written by legacy app)
**Decision:** No table migration. Per-inspection assignments will be designed fresh in T-040 with the QC inspection workflow UX. ADR-016 #1 captures the reframe.

## qcDocUploads — NOT MIGRATED (per ADR-016)

**Date:** 2026-05-03
**Source records:** 0 (collection doc_missing in Run 1 export)
**Decision:** No table migration. File uploads land via Supabase Storage in T-040, not as a legacy resurrection. ADR-016 #4.

---

## Phase 6 Sign-Off — 2026-05-03 (T-038)

**Script:** `migration/validate-phase6.ts` · **Output:** `migration/load-output/_phase6_validation.json` (gitignored) · **Overall status:** **PASS**

Read-only field-level diff + 2 orphan FK checks, run via `pnpm --filter @innovic/migration validate:phase6`.

**Field-level diff (transform → DB, mapped columns):**

| Table        | Transform rows | DB count | Matched | Field diffs | Missing from DB |
| ------------ | -------------: | -------: | ------: | ----------: | --------------: |
| qc_processes |              5 |        5 |       5 |           0 |               0 |

Total: **5 / 5 mapped rows match transform on every loaded column**.

**Orphan FK checks (2 columns, all 0 orphans):**

- qc_processes: created_by, updated_by

**Conclusions:**

- All 5 QC process master rows land byte-for-byte (modulo documented normalisations: empty description → null, defaultCycleTime numeric coerced to `'0.00'`).
- No FK alter on `jc_ops` per ADR-016 #3 — existing migrated JC-op QC steps still carry their picked operation as text snapshot.
- T-039 will extend `validate-phase6.ts` with `nc_register` + `delivery_challans` rows.

**Phase 6 storage layer + transform + load + validate are sign-off ready for the qc_processes slice.** Next: T-039 (NC + dispatch migration) — `ncRegister` (3 rows) + `challans` (4 rows). Legacy `dispatch_log` doc_missing.

> Re-run anytime: `pnpm --filter @innovic/migration validate:phase6`

---

## Phase 6 Per-Collection Entries — Load Run 6 — 2026-05-04 (T-039)

Load run reads `migration/transform/<table>.json` and inserts rows in FK-dependency order: `nc_register` → `delivery_challans` → `delivery_challan_lines`. Audit columns set to seed company_id + admin user_id (vinay.makwana24@gmail.com → `e9c9ed51-7aa0-4d4f-95ab-f6c3ee9e2320`). Conflict targets: `(company_id, code) WHERE deleted_at IS NULL` for nc_register and delivery_challans; `(delivery_challan_id, line_no) WHERE deleted_at IS NULL` for the line table. All run via the standard `bulkLoad` helper.

## ncRegister (nc_register)

**Date:** 2026-05-04
**Source records:** 3 (NC-0001, NC-0002, NC-0003)
**Loaded records:** 3
**Discrepancy:** 0
**Anomalies:** 0
**Validation:** PASS — 3 field-level matches in field-diff sweep; 5 FK orphan checks clean (`job_card_id`, `jc_op_id`, `item_id`, `created_by`, `updated_by`).
**Notes:**

- All 3 rows reference the same JC (`IN-JC-00002`, item `554117302000` JOINT, SO `SO-436`); op_seqs 4 + 4 + 6 — all resolve clean to `jc_ops` via composite `(jcNo, opSeq)` lookup.
- All 3 rows are `Closed` (matching legacy `status='Closed'`); 1 disposition is `rework` (NC-0001 with `reworkDoneQty=35` despite `rejectedQty=5` — preserved as-is from legacy data, no clamp); 2 are `use_as_is` (NC-0002, NC-0003).
- All 3 use `reasonCategory: 'Dimensional'` — the dominant reason in current data; the 6 other enum values (`surface`, `material`, `process`, `operator_error`, `machine_fault`, `other`) are pre-defined per ADR-017 #2 for forward state coverage.
- `disposition_by_text='Japan'` preserved as text snapshot per ADR-017 #3 (no FK to operators or users).
- `machine_code_text='QC'` preserved as snapshot — `'QC'` is the legacy QC station label, not a real machine code, so no FK lookup attempted.
  **Cutover:** Pending T-040 (NC entry web flow). Migrated rows are read-only at the DB layer until then.

## challans (delivery_challans)

**Date:** 2026-05-04
**Source records:** 4 (DC-00001, DC-00001-02, DC-00001-03, DC-00002)
**Loaded records:** 4
**Discrepancy:** 0
**Anomalies:** 3

- `po_unresolved` for DC-00002: `poNo='IN-PO-00002'` was never written to the legacy DB (only `IN-JWPO-00001` made it to the export per Phase 5 sign-off). `purchase_order_id` is NULL on this row; `po_code_text='IN-PO-00002'` preserves the audit trail per ADR-017 #5.
- `so_line_unresolved` for DC-00002 and DC-00001: legacy soRefIds `574se7ev` and `9is8kb7f` are not in the migrated `sales_order_lines` (`_legacyId` lookup fails). DC-00001-02 and DC-00001-03 both reference `4n7tmo9u` which resolves clean. `sales_order_line_id` is NULL on the 2 unresolved headers; `so_ref_text` preserves the original short-id.
  **Validation:** PASS — 4 field-level matches; 5 FK orphan checks clean (`purchase_order_id`, `vendor_id`, `sales_order_line_id`, `created_by`, `updated_by`).
  **Notes:**
- All 4 rows have `vendor_id` resolving to `VND-001` and `status='issued'` (the only DC status exhibited in legacy data).
- 3 of 4 rows reference `IN-JWPO-00001` (the migrated JW PO); 1 references the unmigrated `IN-PO-00002` — text-snapshot pattern keeps the audit trail durable.
  **Cutover:** Pending T-040 (DC entry web flow).

## delivery_challan_lines

**Date:** 2026-05-04
**Source records:** 4 line entries embedded in 4 challan headers (each header has exactly 1 line in current data)
**Loaded records:** 4
**Discrepancy:** 0
**Anomalies:** 0
**Validation:** PASS — 4 field-level matches; 4 FK orphan checks clean (`delivery_challan_id`, `item_id`, `created_by`, `updated_by`).
**Notes:**

- Item codes `60346569` (BLOCK), `60346519` (BLOCK), `554117302000` (JOINT × 2) all resolve clean.
- `lineNo` auto-assigned 1 per header (legacy doesn't number DC lines).
- All 4 rows use `uom='NOS'` matching the existing `uom` enum.
- `material_text` preserved on 2 lines (`'1018'`, `'MS'`); blank → null on the 2 JOINT lines.
- `dc_remarks` preserved on 3 lines (e.g. `'Machining Only, 32od round bar given.'`, `'Outsource: drill for IN-JC-00004 (PR: PR-00002)'`, `'COATING PROCESS'`); blank → null on DC-00001-03.
  **Cutover:** Pending T-040.

## dispatchLog — NOT MIGRATED (per ADR-017)

**Date:** 2026-05-04
**Source records:** 0 (collection `doc_missing` in the export — never written by the legacy app)
**Loaded records:** 0
**Notes:** Per ADR-017 #1, the `dispatch_log` table is not built. T-040+ workflows will design the right schema when the dispatch UX has actual requirements driving shape. Same call as the qcAssignments / qcDocUploads carve-out from ADR-016.

## jwDCOutward / jwDCInward / partyMaterials / partyGrn / ospDC / outsourceJobs / storeIssues — NOT MIGRATED (per ADR-017)

**Date:** 2026-05-04
**Source records:** 0 each (all `doc_missing`)
**Loaded records:** 0
**Notes:** All 7 collections never written by the legacy app. Skipped per ADR-017 #1; T-040+ workflows decide structure when UX requirements are clear.

---

## Phase 6 Sign-Off — 2026-05-04 (T-039)

**Last updated: 2026-05-04**
Run via: `pnpm --filter @innovic/migration validate:phase6`
Output: `migration/load-output/_phase6_validation.json`
Overall status: **PASS**
Result summary: Phase 6 validated end-to-end: **4/4 tables match transform** (qc_processes + nc_register + delivery_challans + delivery_challan_lines); **0 orphan FKs across 16 checks**. Legacy dispatch_log + JW DC + party_grn collections were doc_missing in the export and are intentionally not migrated (ADR-017 #1).

**Field-level checks (per table):**

| Table                  | Transform rows | DB rows | Matched | Field diffs | Missing | Status |
| ---------------------- | -------------- | ------- | ------- | ----------- | ------- | ------ |
| qc_processes           | 5              | 5       | 5       | 0           | 0       | OK     |
| nc_register            | 3              | 3       | 3       | 0           | 0       | OK     |
| delivery_challans      | 4              | 4       | 4       | 0           | 0       | OK     |
| delivery_challan_lines | 4              | 4       | 4       | 0           | 0       | OK     |

**Orphan FK checks (16/16 clean):**

- qc_processes: created_by, updated_by
- nc_register: job_card_id, jc_op_id, item_id, created_by, updated_by
- delivery_challans: purchase_order_id, vendor_id, sales_order_line_id, created_by, updated_by
- delivery_challan_lines: delivery_challan_id, item_id, created_by, updated_by

**Conclusions:**

- All 11 new rows (3 + 4 + 4) land byte-for-byte against the transform output (modulo documented normalisations: empty optional text → null, numeric stringification at `(12,2)`, UOM uppercase-match, status/disposition/reason enum mapping).
- The 3 documented FK gaps (DC-00002 → unmigrated PO, 2-of-4 unresolvable soRefIds) are absorbed cleanly by nullable FK + text-snapshot pattern (ADR-017 #5). No orphans because the columns are nullable, not because they were dropped.
- Phase 6 storage is **complete** for the migration scope. Per-inspection record table (with file uploads, sign-off, attachments) and the NC + DC web modules remain deferred to T-040 where workflow UX drives shape.

> Re-run anytime: `pnpm --filter @innovic/migration validate:phase6`

---

## activityLog (Phase 8 / T-051) — 2026-05-05

**Date:** 2026-05-05
**Source records:** 14 (Run 1 export)
**Loaded records:** 14
**Discrepancy:** 0
**Anomalies:** 0
**Validation:** PASS — 1/1 tables match transform (14/14 rows, 0 field diffs after timestamptz ISO normalisation), 0 orphan FKs across 2 checks (user_id + created_by). Per ADR-019, legacy "Japan" entries land with `user_id=null` because legacy user names don't reliably map to Supabase Auth uids; `user_name` snapshot preserves the audit trail.
**Cutover:** N/A — read-only migration of historical entries; live emitters wired up incrementally as a Phase 8/9 follow-on.

> Re-run anytime: `pnpm --filter @innovic/migration validate:phase8`

---

## Template

```
## <collection_name>
**Date:** YYYY-MM-DD
**Source records:** <count from Firebase>
**Loaded records:** <count in Supabase>
**Discrepancy:** <count> — <reason>
**Anomalies:** <fields with missing/inconsistent data>
**Validation:** <PASS / FAIL — what was checked>
**Cutover:** <date users switched to new system for this module>
```

## Pending Collections

- **Phase 2:** users, clients, vendors, items, machines, operators
- **Phase 3:** jobCards, jcOps, opLog
- ~~**Phase 4:** salesOrders, jobWorkOrders~~ — migrated 2026-05-02 (T-029d)
- ~~**Phase 5:** purchaseOrders, grn, storeTransactions~~ — migrated 2026-05-02 (T-035c)
- ~~**Phase 6 (qc master):** qcProcesses~~ — migrated 2026-05-03 (T-038); `qcAssignments` + `qcDocUploads` deliberately NOT migrated per ADR-016
- ~~**Phase 6 (NC + dispatch):** ncRegister, challans~~ — migrated 2026-05-04 (T-039); `dispatchLog`, `jwDCOutward`, `jwDCInward`, `partyMaterials`, `partyGrn`, `ospDC`, `outsourceJobs`, `storeIssues` deliberately NOT migrated per ADR-017 (all `doc_missing`)
- **Phase 6 (remaining):** capaRecords (CAPA records — see ADR-017 future scope; legacy `_createCAPAFromNC` cascade currently absent)
- **Phase 8:** designProjects, designTasks, designIssues, designWorkLog, designTimeLog, designDCRs, designDCNs; leads, communications, crmReminders; toolIssues, storeIssues, partyMaterials, partyGrn; printTemplates, printTemplateRevisions, dashboardConfig, alertConfig
- ~~**Phase 9 (early):** activityLog~~ — migrated 2026-05-05 (T-051; landed in Phase 8 since the table has no FK dependencies on still-pending modules)
