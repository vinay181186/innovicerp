# MIGRATION-LOG.md — Firebase → Supabase Migration Record

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
