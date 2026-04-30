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
|  |  | | users | 2 |
|  |  | | alertConfig | 1 |
|  |  | | clients | 1 |
|  |  | | dashboardConfig | 1 |
|  |  | | operators | 1 |
|  |  | | purchaseOrders | 1 |
|  |  | | purchaseRequests | 1 |

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

| Table | Input | Rows | Anomalies | Notes |
|---|---:|---:|---:|---|
| users | 2 | 2 | 0 | Both admins; PINs carried in `_legacyPin` for T-015 (load) — Supabase Auth signup will replace with temporary passwords |
| items | 352 | 352 | 8 | All anomalies are `uom_normalised` (6 `Nos`→`NOS`, 2 `Set`→`SET`); no validation skips, no missing fields, no `drawingData` to migrate to Storage |

**id_map state:** users entries are null (Supabase Auth assigns at load time); items entries are deterministic UUIDv5 (stable across re-runs via fixed namespace `f5b8a3a4-1c2d-4e3f-8a5b-6c7d8e9f0a1b`).

**Stubs (not yet wired — pending schemas in T-017/T-018/T-020/T-021):** clients, vendors, machines, operators.

### Run 2 — 2026-04-30T17:00:25Z (T-014 complete: all 6 master-data transforms)
**Inputs:** users, clients, vendors, items, machines, operators export files
**Output:** 6 `<table>.json` files in `migration/transform/` plus updated `_id_map.json` and `_anomalies.json`
**Tests:** 38/38 vitest pass (8 users + 5 clients + 5 vendors + 10 items + 5 machines + 5 operators)
**Total rows:** 371 (vs 354 in Run 1 — added 1 client, 3 vendors, 12 machines, 1 operator)

| Table | Input | Rows | Anomalies | Notes |
|---|---:|---:|---:|---|
| users | 2 | 2 | 0 | Same as Run 1 |
| clients | 1 | 1 | 0 | Single L&T record, address/contact/email all empty in legacy |
| vendors | 3 | 3 | 0 | Mehta Steel + 2 others, all `status: Active`, ratings present |
| items | 352 | 352 | 8 | Same as Run 1 (uom_normalised: 6 `Nos`→`NOS`, 2 `Set`→`SET`) |
| machines | 12 | 12 | 0 | All shop-floor CNCs, statuses Running/Idle |
| operators | 1 | 1 | 0 | Single shop-floor operator (`VNM` / Vinay), userId left null for T-015 |

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
- **Phase 4:** salesOrders, jobWorkOrders
- **Phase 5:** purchaseOrders, grn, storeTransactions
- **Phase 6:** qcProcesses, qcAssignments, qcDocUploads, ncRegister, capaRecords; jwDCOutward, jwDCInward, challans, dispatchLog
- **Phase 8:** designProjects, designTasks, designIssues, designWorkLog, designTimeLog, designDCRs, designDCNs; leads, communications, crmReminders; toolIssues, storeIssues, partyMaterials, partyGrn; printTemplates, printTemplateRevisions, dashboardConfig, alertConfig
- **Phase 9:** activityLog
