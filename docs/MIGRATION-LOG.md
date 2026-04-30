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

---

## Per-Collection Migration Entries

> One entry per collection migrated. Append-only.

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
