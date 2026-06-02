# Legacy HTML — Full Feature Audit

> **Source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` (29 000 lines, 2.3 MB)
> **Date:** 2026-05-20
> **Purpose:** Complete inventory of every screen / workflow / data shape in the legacy single-file ERP, with each item's status in the new React+Supabase app. Replaces the partial coverage that resulted from the Firebase-doc_missing deferral policy (ADRs 016 / 017 / 022 / 023). The user has now directed full legacy parity, so this doc is the build scope.

---

> ⚠️ **Headline counts below are the 2026-05-20 snapshot and are now badly stale.** Since then
> Store, Production, QC, Design, Print Templates, System Settings, Purchase, Access Control and the
> AUDIT-1..6 backlog all shipped. As of **2026-06-02** ~81/93 screens are shipped; the genuinely
> remaining gaps are **CRM (3), Finance (3: invoices/SO costing/stock valuation), Tasks (2), SO
> Documents, and Time Tracker (deferred)**. The per-row Status column has been kept current for the
> rows touched since; treat the aggregate tables as historical. See TASKS.md RPT-1 for the live list.

## Headline numbers

- **Legacy screens (`render*` functions):** ~85 distinct pages, organised into 12 sidebar sections
- **Shipped in new app:** ~22 screens (≈26%)
- **Partial:** ~6 screens (functional but missing legacy features)
- **Missing entirely:** ~57 screens
- **ADRs to reverse:** ADR-016, ADR-017, ADR-022, ADR-023 (all four deferred features that the legacy actively defines)

---

## Status legend

- ✅ **Shipped** — page route + service + tests exist; functional parity
- 🟡 **Partial** — basic version shipped; legacy has features we skipped
- ❌ **Missing** — no equivalent in new app yet
- 📦 **Deferred (ADR)** — explicitly deferred by ADR-016/017/022/023; the audit now says reverse the deferral

---

## Master inventory (all 85 screens)

| #   | Sidebar dept        | nav key            | Legacy render fn (line)                  | New-app route                                              | Status                                                                                                                                                                  |
| --- | ------------------- | ------------------ | ---------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Dashboard           | `home`             | `renderHome` (2486)                      | `/`                                                        | 🟡 Partial — KPI tiles only; missing alert work-list panels per legacy                                                                                                  |
| 2   | Planning            | `plandash`         | `renderPlanDashboard` (9994)             | —                                                          | ❌ Missing                                                                                                                                                              |
| 3   | Planning            | `planning`         | `renderSOPlanning` (9299)                | —                                                          | ❌ Missing                                                                                                                                                              |
| 4   | Planning            | `sooverview`       | `renderSOOverview` (9112)                | —                                                          | ❌ Missing                                                                                                                                                              |
| 5   | Planning            | `sostatus`         | `renderSOStatus` (4255)                  | —                                                          | ❌ Missing                                                                                                                                                              |
| 6   | Planning            | `assytracker`      | `renderAssemblyTracker` (28738)          | —                                                          | ❌ Missing                                                                                                                                                              |
| 7   | Sales (Entry)       | `somaster`         | `renderSOmaster` (11839)                 | `/sales-orders`                                            | ✅ Shipped                                                                                                                                                              |
| 8   | Sales (Entry)       | `jwmaster`         | `renderJWMaster` (12642)                 | `/job-work-orders`                                         | ✅ Shipped                                                                                                                                                              |
| 9   | Sales (Entry)       | `dispatch`         | `renderDispatchRegister` (10711)         | `/customer-dispatches`                                     | ✅ Shipped 2026-06-02 (FIN-1 / ADR-042) — customer Dispatch Register; dispatches ready (produced+QC-accepted) qty per SO line, maintains `dispatched_qty`, gates invoicing |
| 10  | Sales (CRM)         | `crmleads`         | `renderCRMLeads` (15998)                 | —                                                          | 📦 Deferred (ADR-023)                                                                                                                                                   |
| 11  | Sales (CRM)         | `crmreminders`     | `renderCRMReminders` (16283)             | —                                                          | 📦 Deferred (ADR-023)                                                                                                                                                   |
| 12  | Sales (CRM)         | `crmcustomer360`   | `renderCustomer360` (16429)              | —                                                          | 📦 Deferred (ADR-023)                                                                                                                                                   |
| 13  | Sales (Master)      | `clients`          | `renderClients` (12969)                  | `/clients`                                                 | ✅ Shipped                                                                                                                                                              |
| 14  | Sales (Report)      | `sotimeline`       | `renderSOTimeline` (19971)               | —                                                          | ❌ Missing                                                                                                                                                              |
| 15  | Sales (Report)      | `sodocs`           | `renderSODocs` (19478)                   | —                                                          | ❌ Missing                                                                                                                                                              |
| 16  | Sales (Report)      | `pendingsovalue`   | `renderPendingSOValue` (19272)           | —                                                          | ❌ Missing                                                                                                                                                              |
| 17  | Sales (Report)      | `rpt_sales`        | `renderDeptReport('sales')` (20029)      | `/reports`                                                 | 🟡 Partial — covered by general Reports module, not dept-grouped                                                                                                        |
| 18  | Store (Entry)       | `grn`              | `renderGRN` (26444)                      | `/goods-receipt-notes`                                     | ✅ Shipped                                                                                                                                                              |
| 19  | Store (Entry)       | `issueregister`    | `renderIssueRegister` (23874)            | —                                                          | 📦 Deferred (ADR-023)                                                                                                                                                   |
| 20  | Store (Entry)       | `toolissue`        | `renderToolIssue` (23965)                | —                                                          | 📦 Deferred (ADR-023)                                                                                                                                                   |
| 21  | Store (Entry)       | `partygrn`         | `renderPartyGRN` (24251)                 | —                                                          | 📦 Deferred (ADR-017)                                                                                                                                                   |
| 22  | Store (Entry)       | `jwdc`             | `renderJWDC` (24434)                     | `/delivery-challans`                                       | 🟡 Partial — outward + receive shipped (T-059a/b); legacy also tracks "jwDCInward" with cumulative reporting we don't have                                              |
| 23  | Store (Master)      | `items`            | `renderItems` (11481)                    | `/items`                                                   | ✅ Shipped                                                                                                                                                              |
| 24  | Store (Master)      | `partymaterial`    | `renderPartyMaterial` (24129)            | —                                                          | 📦 Deferred (ADR-017)                                                                                                                                                   |
| 25  | Store (Report)      | `store`            | `renderStore` (24803)                    | —                                                          | ❌ Missing (inventory consolidated view per item w/ low-stock alerts, ABC analysis)                                                                                     |
| 26  | Store (Report)      | `stockledger`      | `renderStockLedger` (25013)              | `/store-transactions`                                      | ✅ Shipped                                                                                                                                                              |
| 27  | Store (Report)      | `rpt_store`        | `renderDeptReport('store')` (20029)      | `/reports`                                                 | 🟡 Partial — same as rpt_sales                                                                                                                                          |
| 28  | Design              | `designprojects`   | `renderDesignProjects` (7570)            | —                                                          | 📦 Deferred (ADR-022)                                                                                                                                                   |
| 29  | Design              | `designissues`     | `renderDesignIssuesPage` (7890)          | —                                                          | 📦 Deferred (ADR-022)                                                                                                                                                   |
| 30  | Design              | `designworklog`    | `renderDesignWorkLog` (7935)             | —                                                          | 📦 Deferred (ADR-022)                                                                                                                                                   |
| 31  | Design              | `bommaster`        | `renderBOMMaster` (8438)                 | `/bom-masters`                                             | ✅ Shipped 2026-05-20 (BOM-1..11 per ADR-028) — DB + service + 24 tests + sales-orders cascade hook + web list/detail/create/edit forms + Excel template/import         |
| 32  | Design              | `designtracker`    | `renderDesignTracker` (7259)             | —                                                          | 📦 Deferred (ADR-022)                                                                                                                                                   |
| 33  | Design              | `routecards`       | `renderRouteCards` (10078)               | `/route-cards`                                             | ✅ Shipped 2026-05-20 (RC-1..6 per ADR-029) — ALTER for OSP fields + service w/ revision lifecycle + 21 tests + web list/detail/new/edit + sidebar nav                  |
| 34  | Design              | `rpt_design`       | `renderDeptReport('design')` (20029)     | `/reports`                                                 | 🟡 Partial                                                                                                                                                              |
| 35  | Production (Entry)  | `opentry`          | `renderOpEntry` (5202)                   | `/op-entry`                                                | ✅ Shipped                                                                                                                                                              |
| 36  | Production (Entry)  | `machopentry`      | `renderMachOpEntry` (5540)               | `/op-entry/machines`                                       | ✅ Shipped                                                                                                                                                              |
| 37  | Production (Entry)  | `jcops`            | `renderJCOps` (11349)                    | —                                                          | ❌ Missing (legacy "JC Ops" view — list all open ops across JCs with filters; we don't have this)                                                                       |
| 38  | Production (Entry)  | `dailyreport`      | `renderDailyReport` (10823)              | —                                                          | ❌ Missing (daily summary of production by shift + machine + operator)                                                                                                  |
| 39  | Production (Master) | `jobcards`         | `renderJobCards` (5739)                  | `/job-cards`                                               | 🟡 Partial — list + detail shipped; missing legacy priority + on-hold + reroute actions                                                                                 |
| 40  | Production (Master) | `machines`         | `renderMachines` (13070)                 | `/machines`                                                | ✅ Shipped                                                                                                                                                              |
| 41  | Production (Master) | `operators`        | `renderOperators` (13699)                | `/operators`                                               | ✅ Shipped                                                                                                                                                              |
| 42  | Production (Report) | `dashboard`        | `renderDashboard` (3658)                 | —                                                          | ❌ Missing (production-specific dashboard — different from /qc-dashboard)                                                                                               |
| 43  | Production (Report) | `shopfloor`        | `renderShopFloor` (10286)                | —                                                          | ❌ Missing (live shop-floor wall view — what's running now on every machine)                                                                                            |
| 44  | Production (Report) | `jobqueue`         | `renderJobQueue` (10363)                 | —                                                          | ❌ Missing (per-machine queue of pending jobs ordered by priority)                                                                                                      |
| 45  | Production (Report) | `loading`          | `renderLoading` (5021)                   | —                                                          | ❌ Missing (machine loading view — capacity vs scheduled)                                                                                                               |
| 46  | Production (Report) | `prodschedule`     | `renderProductionSchedule` (15588)       | —                                                          | ❌ Missing (Gantt chart of scheduled jobs)                                                                                                                              |
| 47  | Production (Report) | `prodsolist`       | `renderProdSOList` (22954)               | —                                                          | ❌ Missing (production-team-view of SOs with manufacturing status)                                                                                                      |
| 48  | Production (Report) | `prodjwlist`       | `renderProdJWList` (22995)               | —                                                          | ❌ Missing                                                                                                                                                              |
| 49  | Production (Report) | `rpt_production`   | `renderDeptReport('production')` (20029) | `/reports`                                                 | 🟡 Partial                                                                                                                                                              |
| 50  | QC (Entry)          | `incomingqc`       | `renderIncomingQC` (23748)               | —                                                          | ❌ Missing (incoming-material QC at GRN — currently embedded in our GRN flow, but legacy has standalone view)                                                           |
| 51  | QC (Entry)          | `ncregister`       | `renderNCRegister` (22494)               | `/nc-register`                                             | ✅ Shipped                                                                                                                                                              |
| 52  | QC (Entry)          | `capa`             | `renderCAPA` (22779)                     | —                                                          | 📦 Deferred (ADR-023)                                                                                                                                                   |
| 53  | QC (Entry)          | `qcdashboard`      | `renderQCDashboard` (4126)               | —                                                          | ❌ Missing (QC call register — pending QC inspections by JC op, NOT the same as /qc-dashboard which is the engineer KPI view)                                           |
| 54  | QC (Entry)          | `tpi`              | `renderTPI` (21381)                      | —                                                          | ❌ Missing (Third-Party Inspection workflow)                                                                                                                            |
| 55  | QC (Master)         | `qcprocessmaster`  | `renderQCProcessMaster` (23446)          | —                                                          | ❌ Missing (QC process templates — links inspection types to items; we have qc_processes table but no UI)                                                               |
| 56  | QC (Master)         | `reportmaster`     | `renderReportMaster` (23677)             | —                                                          | ❌ Missing (QC report templates — what data goes on a QC certificate)                                                                                                   |
| 57  | QC (Report)         | `qcengineer`       | `renderQCEngineerDash` (3963)            | `/qc-dashboard`                                            | ✅ Shipped (T-040g)                                                                                                                                                     |
| 58  | QC (Report)         | `qccommand`        | `renderQCCommandCenter` (18613)          | —                                                          | ❌ Missing (org-wide QC overview — different from engineer-level dashboard)                                                                                             |
| 59  | QC (Report)         | `soqcstatus`       | `renderSOQCStatus` (18347)               | —                                                          | ❌ Missing (SO-level QC roll-up — how much of each SO is QC-cleared)                                                                                                    |
| 60  | QC (Report)         | `qchistory`        | `renderQCHistory` (23531)                | —                                                          | ❌ Missing (historical QC log with searchable filters)                                                                                                                  |
| 61  | QC (Report)         | `qcdocs`           | `renderQCDocuments` (23039)              | —                                                          | 📦 Deferred (ADR-016 — qcDocUploads)                                                                                                                                    |
| 62  | QC (Report)         | `rpt_qc`           | `renderDeptReport('qc')` (20029)         | `/reports`                                                 | 🟡 Partial                                                                                                                                                              |
| 63  | Purchase (Entry)    | `purchaserequests` | `renderPurchaseRequests` (6217)          | `/purchase-requests`                                       | ✅ Shipped                                                                                                                                                              |
| 64  | Purchase (Entry)    | `purchaseorders`   | `renderPurchaseOrders` (25209)           | `/purchase-orders`                                         | ✅ Shipped                                                                                                                                                              |
| 65  | Purchase (Entry)    | `outsourcejobs`    | `renderOutsourceJobs` (27044)            | —                                                          | 📦 Deferred (ADR-017)                                                                                                                                                   |
| 66  | Purchase (Entry)    | `ospdc`            | `renderOspDC` (27243)                    | `/delivery-challans`                                       | 🟡 Partial — outsource DC IS the JW DC; legacy splits ospDC + jwdc as separate views w/ slightly different workflows                                                    |
| 67  | Purchase (Entry)    | `servicepo`        | `renderServicePO` (27504)                | —                                                          | ❌ Missing (service POs — labour / maintenance / non-material POs)                                                                                                      |
| 68  | Purchase (Master)   | `vendors`          | `renderVendors` (27734)                  | `/vendors`                                                 | ✅ Shipped                                                                                                                                                              |
| 69  | Purchase (Report)   | `scdash`           | `renderSCDashboard` (16790)              | —                                                          | ❌ Missing (Supply Chain dashboard — vendor performance, PO ageing, on-time delivery)                                                                                   |
| 70  | Purchase (Report)   | `rpt_purchase`     | `renderDeptReport('purchase')` (20029)   | `/reports`                                                 | 🟡 Partial                                                                                                                                                              |
| 71  | Finance             | `invoices`         | `renderInvoices` (21096)                 | `/invoices`                                                | ✅ Shipped 2026-06-02 (FIN-1 / ADR-042) — tax invoice + payments + print; create gated on dispatched − invoiced qty                                                     |
| 72  | Finance             | `socosting`        | `renderSOCosting` (17249)                | `/so-costing`                                              | ✅ Shipped 2026-06-02 (FIN-1 / ADR-042) — Material + Outsource + Machine-Time (machines.hour_rate); list + line/op detail                                               |
| 73  | Finance             | `costcenters`      | `renderCostCenters` (17165)              | —                                                          | ❌ Missing (cost center master — distinct from departments)                                                                                                             |
| 74  | Finance             | `stockvaluation`   | `renderStockValuation` (20927)           | `/stock-valuation`                                         | ✅ Shipped 2026-06-02 (FIN-1 / ADR-042) — on-hand × rate (last GRN→PO), grouped by itemType + Excel export                                                              |
| 75  | Finance             | `rpt_finance`      | `renderDeptReport('finance')` (20029)    | `/reports`                                                 | 🟡 Partial                                                                                                                                                              |
| 76  | System              | `users`            | `renderUsers` (13435)                    | —                                                          | ❌ Missing (user management — currently we use Supabase Auth dashboard directly, no in-app screen)                                                                      |
| 77  | System              | `accesscontrol`    | `renderAccessControl` (13861)            | —                                                          | ❌ Missing (role permissions matrix — defines what each role can see/do per module)                                                                                     |
| 78  | System              | `alerts`           | `renderAlerts` (22323)                   | `/alerts`                                                  | ✅ Shipped                                                                                                                                                              |
| 79  | System              | `alertconfig`      | `renderAlertConfig` (22427)              | `/alerts/config`                                           | ✅ Shipped                                                                                                                                                              |
| 80  | System              | `approvalconfig`   | `renderApprovalConfig` (21608)           | —                                                          | ❌ Missing (configurable approval chains — e.g. PO > X needs admin approval)                                                                                            |
| 81  | System              | `printtemplates`   | `renderPrintTemplates` (14660)           | —                                                          | 📦 Deferred (ADR-023)                                                                                                                                                   |
| 82  | System              | `oplog`            | `renderOpLog` (13194)                    | `/store-transactions` (partial), `/activity-log` (partial) | 🟡 Partial — legacy's oplog is the operator-level production log; we split it across two screens                                                                        |
| 83  | System              | `trash`            | `renderTrash` (11309)                    | —                                                          | 📦 Deferred (ADR-023 — admin trash recovery)                                                                                                                            |
| 84  | System              | `settings`         | `renderSettings` (13351)                 | —                                                          | ❌ Missing (system-wide settings — company info, fiscal year, default UOMs, etc.)                                                                                       |
| 85  | System              | `backup`           | `renderBackup` (21963)                   | —                                                          | ❌ Missing — but actually NOT NEEDED in new app (we have Postgres `pg_dump` cron via T-055 RUNBOOK section; legacy's manual backup screen is a workaround for Firebase) |
| 86  | Tasks               | `taskboard`        | `renderTaskBoard` (14255)                | —                                                          | ❌ Missing (Kanban-style task tracking — assigned to user, status, due date)                                                                                            |
| 87  | Tasks               | `dailyreports`     | `renderDailyReports` (14141)             | —                                                          | ❌ Missing (daily user-submitted task reports — what they did today)                                                                                                    |
| 88  | Tasks               | `actlog`           | `renderActivityLog` (11270)              | `/activity-log`                                            | ✅ Shipped                                                                                                                                                              |
| 89  | Reports             | `reports`          | `renderReports` (20047)                  | `/reports`                                                 | ✅ Shipped                                                                                                                                                              |
| 90  | Reports             | `stuckdashboard`   | `renderStuckDashboard` (18017)           | `/stuck-dashboard`                                         | ✅ Shipped 2026-06-02 (RPT-1 / ADR-041) — phase + op-level stuck rules via shared `so-phase-data` engine + `v_jc_op_status`                                             |
| 91  | Reports             | `socycletime`      | `renderSOCycleTime` (18176)              | `/so-cycle-time`                                           | ✅ Shipped 2026-06-02 (RPT-1 / ADR-041) — per-SO phase durations + filtered-set averages + Excel export                                                                 |
| 92  | Reports             | `timetracker`      | `renderTimeTracker` (18954)              | —                                                          | ❌ DEFERRED (ADR-041) — `op_log` has no hours-worked field; only design_time_log has real hours. Build when hours-capture exists.                                       |
| 93  | Reports             | `reportbuilder`    | `renderReportBuilder` (17526)            | `/saved-reports`                                           | ✅ Shipped (T-041b drag-and-drop builder)                                                                                                                               |

---

## Status snapshot by department

| Dept       | Total screens | Shipped | Partial | Missing | Deferred-by-ADR |
| ---------- | ------------: | ------: | ------: | ------: | --------------: |
| Dashboard  |             1 |       0 |       1 |       0 |               0 |
| Planning   |             5 |       0 |       0 |       5 |               0 |
| Sales      |            11 |       3 |       1 |       4 |               3 |
| Store      |            10 |       4 |       2 |       1 |               3 |
| Design     |             7 |       0 |       1 |       2 |               4 |
| Production |            15 |       4 |       2 |       9 |               0 |
| QC         |            13 |       2 |       1 |       8 |               2 |
| Purchase   |             8 |       3 |       2 |       2 |               1 |
| Finance    |             5 |       0 |       1 |       4 |               0 |
| System     |            10 |       2 |       1 |       4 |               3 |
| Tasks      |             3 |       1 |       0 |       2 |               0 |
| Reports    |             5 |       2 |       0 |       3 |               0 |
| **TOTAL**  |        **93** |  **21** |  **12** |  **44** |          **16** |

(Some screens appear in multiple sidebar locations; total > 85 distinct rows above.)

---

## ADRs to reverse

Now that the audit confirms these workflows exist in the legacy regardless of empty Firebase collections, the deferral ADRs are inverted. **All four should be marked Superseded by a new ADR-028 ("Build to full legacy parity per 2026-05-20 user direction").**

| ADR                  | Originally deferred                                                                                            | Now scoped                                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| ADR-016 (2026-05-02) | qcAssignments, qcDocUploads                                                                                    | Build qcdocs screen, deepen qcdashboard (legacy QC call register)                                         |
| ADR-017 (2026-05-04) | jwDCOutward/Inward, partyMaterials, partyGrn, storeIssues, ospDC, outsourceJobs                                | Build outsourcejobs, ospdc, partymaterial, partygrn, issueregister; deepen jwdc with Inward-tracking view |
| ADR-022 (2026-05-06) | designProjects, designTasks, designIssues, designWorkLog, designDCRs, designDCNs, designTracker, designTimeLog | Build full Design module — 7 screens                                                                      |
| ADR-023 (2026-05-06) | leads, communications, crmReminders, toolIssues, capa, printTemplates                                          | Build full CRM (3 screens), toolissue, capa, printtemplates, trash, dailyreports, taskboard               |

---

## Recommended build order — 6 phases

**Phase A (parity foundation, 1-2 weeks):** the gaps that block other modules from completing.

1. **BOM Master** — required by Design + Planning + Production + Costing. Currently we treat BOM as a free-text field on SO; legacy promotes it to a master with version control.
2. **Route Cards** — reusable op-sequence templates per item. Currently we duplicate ops per JC.
3. **QC Process Master** — links inspection types to items + ops. We have the table from T-040c but no UI.
4. **Cost Center Master** — needed by all downstream finance work.
5. **Settings + Users + Access Control** — needed before non-admin users come on board.

**Phase B (Planning module — 1 week):** all 5 screens.

6. plandash (Planning Dashboard)
7. planning (SO/JW Planning workflow — drag/drop scheduling)
8. sooverview (SO Overview — high-level dept view)
9. sostatus (SO Status Review — drill-down per SO with op-level progress)
10. assytracker (Assembly Tracker — multi-level BOM rollup)

**Phase C (Production deepening — 1.5 weeks):** 9 missing + 2 partial.

11. dashboard (Production Dashboard)
12. shopfloor (live shop-floor wall)
13. jobqueue (per-machine queue)
14. loading (machine loading capacity)
15. prodschedule (Gantt scheduler)
16. prodsolist / prodjwlist (production team views)
17. jcops (JC Operations cross-JC view)
18. dailyreport (production daily summary)
19. Deepen jobcards: priority + on-hold + reroute actions
20. Deepen opentry: legacy quirks not in our v1

**Phase D (QC + Sales + Purchase deepening — 1.5 weeks):**

21. QC: qccommand, soqcstatus, qchistory, incomingqc, qcdashboard (call register), tpi
22. QC masters: qcprocessmaster UI, reportmaster
23. Sales: sotimeline, sodocs, pendingsovalue, dispatch register, dept-grouped reports
24. Purchase: scdash, outsourcejobs, ospdc deepening, servicepo

**Phase E (Design + CRM + Finance — 2 weeks):** the bulk of previously-deferred work.

25. Design (7 screens): projects, issues, work log, BOM master, design tracker, route cards, design reports
26. CRM (3 screens): leads, reminders, customer 360°
27. Finance (4 screens): invoices, socosting, stockvaluation, finance reports

**Phase F (System / Tasks / cross-cutting reports — 1 week):**

28. System: users + accesscontrol UI, approvalconfig, printtemplates, settings
29. Tasks: taskboard + dailyreports
30. Reports cross-cutting: stuckdashboard, socycletime, timetracker

**Total estimate:** 8-9 weeks of focused work to reach 1:1 legacy parity.

---

## What's deliberately NOT in scope (even at full parity)

- `backup` (system) — Postgres `pg_dump` cron + Backblaze B2 replaces the legacy manual backup screen. Workflow moves from a UI button to scheduled CI per RUNBOOK T-055 section.
- Mobile dedicated views — legacy has `#mobileApp` and a separate mobile codepath; our responsive layout handles tablet, and shop-floor mobile is a future T-058+ task.
- Firebase-specific bits like the `setup-card` page and offline sync indicators (legacy had IndexedDB local cache; we have Supabase + TanStack Query with optimistic updates).

---

## Cross-cutting findings (worth capturing before per-screen work)

1. **Departments aren't symmetric.** Production has 15 screens; Tasks has 3. Don't time-budget by screen count alone — Planning has 5 screens but ALL are missing AND drive scheduling logic that touches every JC. Build cost per screen varies 3-5x.

2. **Cascades the legacy has that we partially have:**
   - SO → JW → JC creation chain (✅ shipped)
   - JC → op completion → SO close (✅ shipped via T-033)
   - Outsource OP → DC outward → DC receive → JC complete (✅ shipped via T-059a/b)
   - **Sales Invoice → SO line close** (❌ missing — legacy closes the SO only when invoice is raised, not when dispatch happens)
   - **BOM → SO line auto-creation** (❌ missing — legacy reads BOM and auto-generates child SO lines for sub-assemblies)
   - **PR → PO → GRN → Stock In** (✅ shipped)
   - **CAPA from NC** (❌ missing — legacy auto-creates a CAPA task when NC reason is critical)

3. **Master data we need that doesn't exist yet:**
   - BOM (with versioning)
   - Route cards (op templates per item)
   - Cost centers
   - QC process templates
   - Print templates
   - Approval chains config

4. **Role/permission model.** Legacy has fine-grained Access Control matrix; we have 7-role enum baked in code. Need a runtime config table OR the User Management screen surfacing what's already in the JWT.

5. **Print templates are pervasive.** Every transactional doc (SO, JW, JC, PO, GRN, DC, NC, Invoice) has a print template. We've shipped zero. This is a single feature but it gates 10+ pages where users expect a "Print" action.

---

## Recommended next step (after this audit is approved)

1. **User reviews this doc** — confirm priorities, redirect if any module is wrong or out of scope.
2. **Open ADR-028** "Build to full legacy parity per user direction 2026-05-20" — supersedes ADRs 016/017/022/023.
3. **Begin Phase A** with BOM Master (the biggest dependency for downstream modules).

---

## How this doc was built

- Grepped `data-page="..."` attributes in the legacy HTML to enumerate sidebar nav targets → ~85 distinct routes.
- Grepped `function render[A-Z]\w+\(` to find render functions for each → ~80 functions.
- Cross-referenced against `apps/web/src/router.tsx` + `apps/web/src/modules/*/routes/` to determine shipped status.
- Read sections of the legacy HTML where the audit needed detail (Production dashboard, BOM master, Planning workflow).

Deep field-by-field specs per screen are a follow-up — a single doc this size already covers the SCOPE question; per-screen build specs land as we work each phase.
