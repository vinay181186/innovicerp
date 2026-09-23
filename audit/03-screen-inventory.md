# Screen Inventory — Innovic ERP web app

Scope: `apps/web/src/router.tsx` + every `apps/web/src/modules/*/routes/*.tsx` (138 route files, all present in `router.tsx`'s route tree) + `apps/web/src/components/shared/nav-sections.ts` (menu grouping). Cross-checked against `design-ref/README.md`, `design-ref/guidelines/consistency.html`, `design-ref/components/layout/*.jsx`, `design-ref/components/data/*.jsx`, `design-ref/ui_kits/erp/*.jsx`.

Method: every route file was read directly (or, where it is a thin gate/wrapper, its real rendered view/form component was read too) by four parallel sub-agents plus direct reads of the largest/most representative screens by this agent. Where a route delegates to a large shared component (e.g. `PoForm`, `SoSheetTable`, `JcStatusContent`), that component's line count is noted in parentheses in the LOC column and its composition is folded into the Pattern/Table-style columns — the table reflects the real rendered page, not the wrapper file alone.

---

## A. Master table — one row per route (138 rows, sorted by module)

`Module | Route path | File | Pattern | Table style today | Uses StatStrip? | Uses shared search? | Lines of code | Notes`

| Module | Route path | File | Pattern | Table style today | StatStrip? | Shared search? | LOC | Notes |
|---|---|---|---|---|---|---|---|---|
| access-control | /access-control | modules/access-control/routes/list.tsx | SETTINGS/ADMIN (per-user tier/department override matrix) | `.innovic-table` plain | No | No | 261 (modal 1303) | 6-col table; opens a 1303-line ConfigureAccessModal per row; no search/filter box |
| activity-log | /activity-log | modules/activity-log/routes/list.tsx | LIST (system log register) | `.innovic-table` plain | No | Yes (local debounced input) | 339 | 7-col table |
| alerts | /alerts/config | modules/alerts/routes/config.tsx | SETTINGS/ADMIN (on/off + threshold config) | `.innovic-table` plain | No | No | 188 | 5-col table |
| alerts | /alerts | modules/alerts/routes/dashboard.tsx | DASHBOARD | `.innovic-table` plain | No | No | 328 | hand-rolled KPI tiles, not shared StatStrip; 6-col table |
| alerts | /alerts/$code | modules/alerts/routes/drill.tsx | REPORT/PRINT (drill-down of records for one alert) | `.innovic-table` plain | No | No | 167 | columns driven dynamically by server `columns` registry; read-only |
| approval-config | /approval-config | modules/approval-config/routes/page.tsx | SETTINGS/ADMIN | `.innovic-table` plain | No | No | 515 | toggles + limits + approver picker; 5-col activity table at bottom |
| approvals | /approvals | modules/approvals/routes/page.tsx | OTHER (tabbed pending-approvals queue; only Log Entry tab wired, PO/PR disabled) | none (card/panel list) | No | No | 104 (LogEntryApprovals 364) | tab bar with disabled future tabs |
| assembly | /assemblies/$soId | modules/assembly/routes/detail.tsx | DETAIL (SO assembly readiness + batch/unit tracking) | `.innovic-table` plain | No | No | 773 | 2 tables (11-col readiness, 9-col batch/unit); Start/Stop/Undo-last-unit/Dispatch actions |
| assembly | /assemblies | modules/assembly/routes/list.tsx | LIST | `.innovic-table` plain | No | Yes (local input + status chips) | 309 | 8-col table |
| backup | /backup | modules/backup/routes/page.tsx | SETTINGS/ADMIN | `.innovic-table` plain | No | No | 254 | 2-col table (Collection / Records) |
| bom-master | /bom-masters/$id | modules/bom-master/routes/detail.tsx | DETAIL | `.innovic-table` plain | No | No | 403 | 3 tables incl. nested previous-revision part list; `window.confirm` on delete |
| bom-master | /bom-masters/$id/edit | modules/bom-master/routes/edit.tsx | FORM | none | No | No | 130 (bom-form 1375) | thin wrapper on shared 1375-line form (new+edit) |
| bom-master | /bom-masters | modules/bom-master/routes/list.tsx | LIST | `.innovic-table.tbl-grid` sheet | No | Yes (local debounced) | 480 | 10-col sheet, expandable rows reveal nested 5-col part list |
| bom-master | /bom-masters/new | modules/bom-master/routes/new.tsx | FORM | none | No | No | 78 (bom-form 1375) | same shared form as edit |
| clients | /clients/$id | modules/clients/routes/detail.tsx | DETAIL | none (form-grid pairs) | No | No | 198 | two-step inline delete confirm, not window.confirm |
| clients | /clients/new, /clients/$id/edit | modules/clients/routes/edit.tsx | FORM (one file, both routes) | none | No | No | 180 (ClientForm 357) | wraps shared ClientForm |
| clients | /clients | modules/clients/routes/list.tsx | LIST | `.innovic-table.tbl-grid` sheet | Yes | Yes (local debounced) | 545 | 8-col sheet, frozen header band |
| cost-centers | /cost-centers/$id | modules/cost-centers/routes/detail.tsx | DETAIL | none (form-grid) | No | No | 178 | two-step inline delete confirm |
| cost-centers | /cost-centers/$id/edit | modules/cost-centers/routes/edit.tsx | FORM | none | No | No | 110 (CostCenterForm 221) | wraps shared form |
| cost-centers | /cost-centers | modules/cost-centers/routes/list.tsx | LIST | `.innovic-table.tbl-grid` sheet | No | Yes (local debounced) | 434 | 8-col sheet; per-column sort deliberately dropped to match SO standard |
| cost-centers | /cost-centers/new | modules/cost-centers/routes/new.tsx | FORM | none | No | No | 86 (CostCenterForm 221) | same shared form as edit |
| customer-dispatches | /customer-dispatches/new | modules/customer-dispatches/routes/create.tsx | FORM | `.innovic-table` plain (DispatchLineTable) | No | No (type-to-search line entry) | 386 (line-table 324) | SO picker header + shared line table; qty capped at Pending (ADR-180) |
| customer-dispatches | /customer-dispatches | modules/customer-dispatches/routes/list.tsx | LIST | custom (DcCard cards, each with its own `.innovic-table`) | Yes | Yes (local input) | 435 (card 241) | SO/JW tabs; `window.alert` popup-blocked guard |
| daily-report | /daily-report | modules/daily-report/routes/list.tsx | REPORT/PRINT (shift/op log with print) | `.innovic-table` plain | No | No | 346 | 11-col table; two `window.alert` popup-blocked guards |
| daily-task-reports | /daily-task-reports | modules/daily-task-reports/routes/list.tsx | LIST | `.innovic-table` plain | No | No | 133 (report-modals 310) | New/Edit/View via 3 modals |
| delivery-challans | /delivery-challans/new | modules/delivery-challans/routes/create.tsx | FORM (multi-source wizard: PO-DC / NC-return DC) | `.innovic-table` plain (3 tables) | No | No (local search inside picker) | 1273 | largest FORM in the app; PO/NC picker + line-entry + NC-return tables |
| delivery-challans | /delivery-challans/$id | modules/delivery-challans/routes/detail.tsx | DETAIL | `.innovic-table` plain | No | No | 484 (receipts-panel 118) | embeds its own `.innovic-table` sub-panel; `window.alert` popup-blocked guard |
| delivery-challans | /delivery-challans | modules/delivery-challans/routes/list.tsx | LIST | custom (DcCard cards, each with own `.innovic-table`) | Yes | Yes (local debounced) | 377 (card 259) | table→card conversion was a deliberate fix for sideways-scroll bugs; also an "at_vendor" tab |
| delivery-challans | /delivery-challans/$id/receive | modules/delivery-challans/routes/receive.tsx | FORM (goods-receipt entry against a DC) | `.innovic-table` plain | No | No | 351 | 8-col receive-line table |
| design-issues | /design-issues | modules/design-issues/routes/list.tsx | LIST (cross-project issues register) | `.innovic-table` plain | No | Yes (local input + status chips) | 261 | 9-col table; AssignTaskButton |
| design-projects | /design-projects/$id | modules/design-projects/routes/detail.tsx | DETAIL (header + 4 tabs: tasks/issues/checklist/dcr-dcn) | `.innovic-table` plain (4 tables across tabs) | No | No | 2127 | **largest file in the app**; many modals; `window.confirm` on release |
| design-projects | /design-projects | modules/design-projects/routes/list.tsx | LIST (card grid, no table) | custom (card grid + progress bars) | No | Yes (local input + chips) | 635 | hand-rolled KPI strip; "Add Project" modal with SO picklist |
| design-tracker | /design-tracker | modules/design-tracker/routes/list.tsx | LIST (design job register with workflow actions) | `.innovic-table` plain | No | Yes (local input + chips) | 1050 | 2 tables (10-col + 4-col log sub-table); `window.confirm` ×2, `window.prompt` |
| design-work-log | /design-work-log | modules/design-work-log/routes/list.tsx | OTHER (tabbed: time-entry form + log register + engineer-hours matrix) | `.innovic-table` plain (4 tables) | No | No (dropdown/date filters only) | 1121 | matrix-style Engineer × Date attendance table; `window.confirm` on delete |
| goods-receipt-notes | /goods-receipt-notes/$id | modules/goods-receipt-notes/routes/detail.tsx | DETAIL | `.innovic-table` plain | No | No | 375 | footer totals row; inline delete confirm; `window.alert` popup-blocked |
| goods-receipt-notes | /goods-receipt-notes/$id/edit, /new | modules/goods-receipt-notes/routes/edit.tsx | FORM | none | No | Yes (SearchableSelect — QC inspector) | 182 (form 722) | dynamic line items via useFieldArray; QC fields lock once QC-completed |
| goods-receipt-notes | /goods-receipt-notes | modules/goods-receipt-notes/routes/list.tsx | LIST | custom (card-per-GRN) + `.innovic-table.tbl-ctr` inside expanded lines | Yes | Yes (local debounced) | 715 | ported from a 12-col table to cards; QC-status filter pills; server-paginated |
| incoming-qc | /incoming-qc | modules/incoming-qc/routes/index.tsx | OTHER (KPI dashboard + pending-inspection queue + completed register) | `.innovic-table.tbl-grid` (both tables) | No (custom Card tiles) | No | 488 | 11- and 14-col tables; deep-link `?line=` auto-opens Inspect modal |
| invoices | /invoices/new | modules/invoices/routes/create.tsx | FORM | none (card-per-line CSS grid) | No | Yes (SearchableSelect) | 417 | prefill from `?dispatchId`; live subtotal/GST/total preview |
| invoices | /invoices/$id | modules/invoices/routes/detail.tsx | DETAIL | `.innovic-table` plain (Payments) | No | No | 298 | A4 print-preview via `dangerouslySetInnerHTML`; money hidden for L1 |
| invoices | /invoices | modules/invoices/routes/list.tsx | LIST | `.innovic-table` plain | No (ad-hoc KPI cards) | No (SO tab has no box) | 250 | SO/JW tab switcher; money hidden for L1 |
| items | /items/$id | modules/items/routes/detail.tsx | DETAIL | `.innovic-table` plain (Stock Ledger) | No | No | 421 | stock badge; drawing preview modal; `window.alert` on error |
| items | /items/new, /items/$id/edit | modules/items/routes/edit.tsx | FORM | none | No | No | 197 (item-form 424) | exit-confirm guard |
| items | /items | modules/items/routes/list.tsx | LIST | `.innovic-table.tbl-grid` sheet | Yes | Yes (local debounced) | 810 | 8-col sheet + thumbnail; Excel import/export; `window.confirm` on delete |
| jc-ops | /jc-ops | modules/jc-ops/routes/list.tsx | LIST | `.innovic-table` plain | No | No (JC select filter only) | 1121 | **14-column board**; 3 modals (Change Machine / Create PR / Outsource Balance) |
| job-cards | /job-cards/$id/edit | modules/job-cards/routes/edit.tsx | FORM (rich editable status page) | none (card-based op editor) | No (custom JcStatTiles) | No | 66 (view chain ~4,600 combined) | dependent-field cascades (machine→group, vendor lookups) |
| job-cards | /job-cards | modules/job-cards/routes/list.tsx | LIST | `.innovic-table.tbl-grid` (List) + custom card view | Yes | Yes (local debounced) | 1037 | List/Card toggle (localStorage); 12-col sheet; client-computed KPI strip |
| job-cards | /job-cards/new | modules/job-cards/routes/new.tsx | FORM | one `.innovic-table` inside job-card-form.tsx | No | No (datalist free text) | 60 (form 1145) | optional `?sourceLineId` deep-link |
| job-cards | /job-cards/$id | modules/job-cards/routes/status.tsx | DETAIL/DASHBOARD hybrid (stat tiles + route-flow op-card strip + tabs) | none directly (route-flow cards) | No (custom JcStatTiles) | No | 35 (view chain ~4,600 combined) | header tile strip + wrapping op-card strip + 4 tabs; Print/Excel/Edit |
| job-queue | /job-queue | modules/job-queue/routes/list.tsx | OTHER (per-machine work queue, manual ▲/▼ reorder) | `.innovic-table` plain | No (custom machine-card strip) | No | 465 | 14-col table; admin-only "Link machine codes" backfill tool |
| job-work-orders | /job-work-orders/$id | modules/job-work-orders/routes/detail.tsx | DETAIL | `.innovic-table` plain (lines + documents) | No | No | 537 | file-preview modal; inline delete confirm; money hidden for L1 |
| job-work-orders | /job-work-orders/new, /$id/edit | modules/job-work-orders/routes/edit.tsx | FORM | `.innovic-table.tbl-ctr` inside form | No | Yes (SearchableSelect) | 230 (form 1023) | best-effort Client-PO + Email-Ref upload after save |
| job-work-orders | /job-work-orders | modules/job-work-orders/routes/list.tsx | LIST | custom (card-per-JWSO) + `.innovic-table` plain in expanded lines | No (per-card QtyBox) | Yes (local debounced) | 389 | `window.confirm` on delete |
| jw-dc | /jw-dc/$id | modules/jw-dc/routes/detail.tsx | DETAIL | `.innovic-table` plain | No | No | 229 | sent/returned/pending totals; `window.alert` popup-blocked |
| jw-dc | /jw-dc | modules/jw-dc/routes/list.tsx | LIST | `.innovic-table` plain | No | Yes (local input, URL-seeded once) | 1214 | Outward/Inward tab switcher; two ~300–600-line inline New-DC modals |
| machine-loading | /machine-loading | modules/machine-loading/routes/list.tsx | DASHBOARD | `.innovic-table` plain (3 tables) | No (custom machine-card grid) | No | 669 | bespoke `.mach-card` inline CSS not ported to theme; `window.alert` |
| machines | /machines/$id | modules/machines/routes/detail.tsx | DETAIL | none (form-grid) | No | No | 224 | inline delete confirm |
| machines | /machines/new, /$id/edit | modules/machines/routes/edit.tsx | FORM | none | No | No | 154 (machine-form 398) | — |
| machines | /machines | modules/machines/routes/list.tsx | LIST (Machines\|Groups tabs) | `.innovic-table.tbl-grid` sheet | No | Yes (local debounced, Machines tab) | 477 | 9-col sheet; ₹/hr column hidden for L1 |
| nc-register | /nc-register/$id | modules/nc-register/routes/detail.tsx | DETAIL (with dispose/close workflow) | none (context strip + form-grid) | Yes | No | 767 | rejected/cleared/failed/open StatStrip; inline Dispose + Create-DC panels; Create-CAPA |
| nc-register | /nc-register/$id/edit | modules/nc-register/routes/edit.tsx | FORM | none | No | Yes (SearchableSelect) | 156 (form 506) | editable only while status='pending' |
| nc-register | /nc-register | modules/nc-register/routes/list.tsx | LIST | custom (card-per-NC) | Yes | Yes (local debounced) | 636 | NC Register / CAPA tab strip; no expand (no line items) |
| nc-register | /nc-register/new | modules/nc-register/routes/new.tsx | FORM | none | No | Yes (SearchableSelect) | 144 (form 506) | deep-link seed from a QC op card |
| op-entry | /op-entry | modules/op-entry/routes/index.tsx | OTHER (transactional op-logging workspace) | `.innovic-table` plain (JcOpsTable) | No | Yes (SearchableSelect — JC picker) | 485 | By-JC/By-Machine tabs; realtime subscriptions; deep-link auto-opens entry modal |
| op-entry | /op-entry/running | modules/op-entry/routes/running.tsx | DASHBOARD ("Live Operations Board", realtime) | `.innovic-table` plain | No | No | 74 (running-ops-board 287 + shop-floor-view 342) | Table / By-Machine view toggle; realtime |
| op-log | /op-log | modules/op-log/routes/list.tsx | LIST (read-only register) | `.innovic-table` plain | No | No (JC-code filter only) | 394 | **16-column** table; Planned-vs-Actual machine columns; no delete by design |
| operators | /operators/$id | modules/operators/routes/detail.tsx | DETAIL | none (form-grid) | No | No | 199 | inline delete confirm |
| operators | /operators/new, /$id/edit | modules/operators/routes/edit.tsx | FORM | none | No | No | 217 (operator-form 295) | — |
| operators | /operators | modules/operators/routes/list.tsx | LIST | `.innovic-table.tbl-grid` sheet | No | Yes (local debounced) | 484 | 7-col sheet; Excel import/export; `window.confirm` on delete |
| party-grn | /party-grn | modules/party-grn/routes/list.tsx | LIST | custom (PartyGrnCard cards, no table) | Yes | Yes (local input) | 338 (+631 Issue-tab) | Receive/Issue tabs; 3-tile StatStrip; Prev/Next pagination |
| party-materials | /party-material | modules/party-materials/routes/list.tsx | LIST | `.innovic-table` plain | No | Yes (local input) | 931 | 10-col table; cascading Client→SO/JWSO→Item picker; `window.alert`/`window.confirm` on delete |
| pending-so-value | /pending-so-value | modules/pending-so-value/routes/list.tsx | REPORT/PRINT | `.innovic-table` plain + totals row | No (custom KPI strip) | Yes (local input) | 386 | 4 filter buttons; 5-tile KPI strip; 11-col table; money hidden for L1 |
| plans | /plans/$id | modules/plans/routes/detail.tsx | DETAIL | `.innovic-table` plain (Operations) | No | No | 434 | Finalize/Execute/Edit/Delete (inline confirm); price hidden for L1 |
| plans | /plans/$id/edit | modules/plans/routes/edit.tsx | FORM | none (delegates to PlanForm) | No | No | 193 (route only) | hides Ops editor for route-card-driven plans (ADR-170) |
| plans | /plans | modules/plans/routes/list.tsx | LIST | `.innovic-table.tbl-grid` sheet | No (custom PlanningKpiStrip) | Yes (local input into URL) | 524 | All/Pending pills; 10-col fixed-width sheet; per-row context action |
| plans | /plans/new | modules/plans/routes/new.tsx | FORM | none (delegates to PlanForm) | No | No | 57 (route only) | exit-confirm guard |
| print-templates | /print-templates | modules/print-templates/routes/editor.tsx | REPORT/PRINT (WYSIWYG print-template builder, admin-only) | custom (plain table/inline-style doc mock) | No | No | 1289 | 6 doc-type selector; block editor + variable insertion; Revisions modal; `window.confirm` ×3 |
| production-dashboard | /production-dashboard | modules/production-dashboard/routes/index.tsx | DASHBOARD | `.innovic-table` plain (2 tables) | No (stat-grid cards) | No | 735 | 4 stat cards; machine-wise panel; open-JC card grid; SC snapshot tiles |
| production-orders | /production-orders/close | modules/production-orders/routes/close.tsx | FORM (multi-step close workflow) | none (delegates to PoCloseLedger) | No | Yes (SearchableSelect) | 333 | Plan→PO→JC 3-step picker; canClose gate with reason banner |
| production-orders | /production-orders/$id | modules/production-orders/routes/detail.tsx | DETAIL | none (delegates to PoCloseLedger) | No | No | 318 | progress bar; ADR-179 progressive/partial close ledger |
| production-orders | /production-orders | modules/production-orders/routes/list.tsx | LIST | `.innovic-table` plain (TanStack react-table) | Yes | Yes (local debounced) | 464 | explicitly cites SO Master as reference; sortable, 13 cols; cap 500 |
| production-orders | /production-orders/new | modules/production-orders/routes/new.tsx | FORM | none | No | No (plain select for Route Card) | 473 | Plan picker + Route Card select + dispatch date; read-only PlanSummary recap |
| production-schedule | /production-schedule | modules/production-schedule/routes/list.tsx | OTHER (drag-drop Gantt board) | custom (bespoke inline-style table) | No | No | 555 | **30-day drag-drop Gantt**; 6 stat cards; native HTML5 drag reschedule |
| purchase-orders | /purchase-orders/$id | modules/purchase-orders/routes/detail.tsx | DETAIL | `.innovic-table` plain | No | No | 712 | Approve/Reject modals; Print; Issue DC/Receive GRN buttons |
| purchase-orders | /purchase-orders/$id/edit | modules/purchase-orders/routes/edit.tsx | FORM | none (delegates) | No | No | 69 (PoForm 1010) | wraps shared `<PoForm mode="edit">` |
| purchase-orders | /purchase-orders/from-pr | modules/purchase-orders/routes/from-pr.tsx | FORM | none (delegates) | No | No | 65 (PoForm 1010) | `?prId=` prefill |
| purchase-orders | /purchase-orders | modules/purchase-orders/routes/list.tsx | LIST | custom (List View → PoSheetTable, likely tbl-grid; Card View bespoke) | No | Yes (local debounced) | 548 (PoSheetTable unmeasured) | List/Card toggle (localStorage) |
| purchase-requests | /purchase-requests/$id | modules/purchase-requests/routes/detail.tsx | DETAIL | none (fact-strip, no table) | No | No | 536 | PR→PO balance tracking (ADR-152); Close Balance modal |
| purchase-requests | /purchase-requests/$id/edit, /new | modules/purchase-requests/routes/edit.tsx | FORM (one file, both routes) | none (delegates) | No | No | 248 (PurchaseRequestForm 452) | PR locks read-only once linked to a PO |
| purchase-requests | /purchase-requests | modules/purchase-requests/routes/list.tsx | LIST | custom (PrCard cards, no table) | Yes | Yes (local debounced) | 431 | PR/Outsource-Jobs tabs; Approve via `window.confirm`, Reject via `window.prompt` |
| qc-call-register | /qc-call-register | modules/qc-call-register/routes/index.tsx | OTHER (live QC call queue/register) | custom (QcSheetTable/QcStageStrip) | No (custom stage strip) | Yes (local input) | 574 | QC/TPI tabs; deep-link `?line=`/`?op=`; per-row inspect popups |
| qc-command | /qc-command | modules/qc-command/routes/index.tsx | DASHBOARD (5-tab QC control centre) | none in this file (5 tab components) | No (hand-rolled stat tiles) | No | 228 (+5 tab components) | Queue/FPY/Pareto/Inspector/Rework tabs; Pick-Up/Assign |
| qc-documents | /qc-docs | modules/qc-documents/routes/list.tsx | OTHER (SO-pivoted QC matrix + file register + SO-status, 3 views) | `.innovic-table` plain (matrix has a per-column filter row) | No | Yes (SearchableSelect SO picker + per-column filters) | 1557 | **largest LIST-family file**; Excel export; upload/view/delete modals; `window.confirm`/`alert` |
| qc-history | /qc-history | modules/qc-history/routes/index.tsx | REPORT/PRINT (read-only history) | `.innovic-table` plain (2 tables) | No (stat cards) | Yes (local input + date range) | 454 | All/Pending/Completed tabs; overdue-row blink class |
| qc-processes | /qc-processes/$id | modules/qc-processes/routes/detail.tsx | DETAIL | none (form-grid) | No | No | 186 | inline confirm; Active/Inactive badge |
| qc-processes | /qc-processes/$id/edit | modules/qc-processes/routes/edit.tsx | FORM | none (delegates) | No | No | 119 (QcProcessForm 202) | — |
| qc-processes | /qc-processes | modules/qc-processes/routes/list.tsx | LIST | `.innovic-table.tbl-grid` sheet | No | Yes (local debounced) | 476 | QC Processes/Report Types tabs; `window.confirm` on delete |
| qc-processes | /qc-processes/new | modules/qc-processes/routes/new.tsx | FORM | none (delegates) | No | No | 94 (QcProcessForm 202) | — |
| raw-material | /raw-material | modules/raw-material/routes/index.tsx | LIST (Grade\|Size dual-master tabs) | none in this file (GradeTab/SizeTab) | No | Yes (local input, cleared on tab switch) | 122 | — |
| reports | /reports | modules/reports/routes/list.tsx | REPORT/PRINT | `.innovic-table` plain (dept-mode panels) | No | No | 350 | dept-grouped chip buttons; Excel export |
| reports | /reports/$slug | modules/reports/routes/run.tsx | REPORT/PRINT | `.innovic-table` plain | No | No (dynamic filter form) | 398 | per-report dynamic filter form; CSV + Excel export |
| route-cards | /route-cards/$id | modules/route-cards/routes/detail.tsx | DETAIL | `.innovic-table` plain (ops + expandable nested revision-history) | No | No | 568 | Print button; `window.confirm` on delete |
| route-cards | /route-cards/$id/edit | modules/route-cards/routes/edit.tsx | FORM | none (delegates) | No | No | 144 (RouteCardForm 977) | carries a revision note |
| route-cards | /route-cards | modules/route-cards/routes/list.tsx | LIST | `.innovic-table.tbl-grid` sheet | No | Yes (local debounced) | 492 | expandable row (▸ reveals op-sequence chips) |
| route-cards | /route-cards/new | modules/route-cards/routes/new.tsx | FORM | none (delegates) | No | No | 97 (RouteCardForm 977) | seeded via `?itemId=`/`?itemCode=`/`?itemName=` |
| sales-orders | /sales-orders/$id | modules/sales-orders/routes/detail.tsx | DETAIL | `.innovic-table.tbl-ctr` (centred variant) | No | No | 689 | 13-col line table + milestones table; in-app file-preview modal |
| sales-orders | /sales-orders/new, /$id/edit | modules/sales-orders/routes/edit.tsx | FORM (one file, both routes) | none (delegates to SalesOrderForm) | No | No | 228 | uploads client-PO + email-ref files after create; edit admin-only |
| sales-orders | /sales-orders | modules/sales-orders/routes/list.tsx | LIST (Card/Sheet toggle, expandable rows) | `.innovic-table.tbl-grid` (List, via SoSheetTable) + `.tbl-ctr` (expanded sub-tables) | No (hand-rolled pill filter) | Yes (local debounced) | 811 (SoSheetTable unmeasured) | dual table style on one page; Expand-all; BOM sub-table |
| saved-reports | /saved-reports/$id/edit | modules/saved-reports/routes/edit.tsx | FORM | custom (shadcn Table/Card, no `.innovic-table`) | No | No | 122 (Builder 794) | **shadcn design system, not Innovic panel classes** |
| saved-reports | /saved-reports | modules/saved-reports/routes/list.tsx | LIST | custom (no `<table>` at all — shadcn Card list) | No | No | 139 | `window.confirm` on delete; shared/private badges |
| saved-reports | /saved-reports/new | modules/saved-reports/routes/new.tsx | FORM | custom (shadcn, via Builder) | No | No | 105 (Builder 794) | same Builder as edit |
| saved-reports | /saved-reports/$id | modules/saved-reports/routes/run.tsx | REPORT/PRINT | custom (shadcn Table via ResultTable) | No | No | 101 (ResultTable 195) | Excel export |
| sc-dashboard | /sc-dashboard | modules/sc-dashboard/routes/page.tsx | DASHBOARD | `.innovic-table` plain (4 tables) | No (hand-rolled stat-grid) | Yes (datalist-backed filters) | 663 | Pending PO Tracker up to 13 cols; money hidden for L1 |
| search | /search | modules/search/routes/results.tsx | OTHER (global search results deep-link page) | `.innovic-table` plain (via results-table.tsx) | Yes (as kind filter) | No (term from URL `?q=`) | 49 (search-results 205) | 7-col results table; reused by header search popup |
| settings | /settings | modules/settings/routes/index.tsx | SETTINGS/ADMIN | none (form-grid + sub-panels) | No | No | 353 (+OspProcessesPanel 370, DataIntegrityPanel 153) | react-hook-form; embeds OSP Processes + Data Integrity panels |
| so-costing | /so-costing/$id | modules/so-costing/routes/detail.tsx | DETAIL | `.innovic-table` plain | No | No | 252 | 9-col table with material/op sub-rows; money hidden for L1 |
| so-costing | /so-costing | modules/so-costing/routes/list.tsx | LIST | `.innovic-table` plain | No | Yes (local input) | 149 | up to 10 cols (5 money cols hidden for L1) |
| so-cycle-time | /so-cycle-time | modules/so-cycle-time/routes/page.tsx | REPORT/PRINT | `.innovic-table` plain | No (custom "Avg" tiles) | Yes (input + select) | 286 | 11-col table; Export Excel; amber/red duration thresholds |
| so-overview | /so-overview | modules/so-overview/routes/list.tsx | LIST (with in-page DETAIL drill-down) | `.innovic-table` plain (both tables) | No (hand-rolled stat-grid) | Yes (URL-backed) | 909 | **14-col list + 15-col drill-down table**; click row to replace list with SO breakdown |
| so-planning | /planning | modules/so-planning/routes/workflow.tsx | OTHER (two-level order-list → order-detail workflow) | `.innovic-table` plain (fixed table-layout + colgroup %) | No | Yes (local input, order list + cross-order line search) | 1583 | **largest file in the batch**; SO\|JWSO toggle; 16-col line table; 7 distinct modal kinds |
| so-status | /sales-orders/$id/status | modules/so-status/routes/detail.tsx | DETAIL | `.innovic-table` plain (via SoStatusDetailView, 2 tables) | No | No | 26 (SoStatusDetailView 771) | thin wrapper, same shared view as index below |
| so-status | /so-status | modules/so-status/routes/index.tsx | OTHER (two-pane master/detail review) | `.innovic-table` plain (right pane); left pane is a card list | No | Yes (local input on left pane) | 164 (SoStatusDetailView 771) | 260px left selector pane (cards + progress bar) + right detail pane |
| stock-valuation | /stock-valuation | modules/stock-valuation/routes/page.tsx | REPORT/PRINT | `.innovic-table` plain | No (panel-tile grid) | Yes (local input) | 277 | 8-col table with `<tfoot>` totals; category pill filter; Excel export |
| store-inventory | /store-inventory | modules/store-inventory/routes/list.tsx | LIST (KPI strip + table, tab to Stock Ledger) | `.innovic-table` plain | Yes | Yes (local input) | 847 | Inventory\|Ledger tabs; up to 12 cols; ±Adjust/Min-Qty/Manual-Receipt modals |
| store-issues | /issue-register | modules/store-issues/routes/list.tsx | LIST (Items\|Tools tabs) | `.innovic-table` plain | No | Yes (local input) | 552 | 10-col table; pagination Prev/Next; New Issue modal |
| stuck-dashboard | /stuck-dashboard | modules/stuck-dashboard/routes/page.tsx | DASHBOARD | `.innovic-table` plain (one table per stage group) | No (hand-rolled Tile grid) | No | 218 | grouped-by-stage tables, 3-step severity colour ramp |
| tasks | /task-board | modules/tasks/routes/board.tsx | OTHER (kanban-style board: tabs + KPI filter strip + table + modals) | `.innovic-table` plain (via TaskTable) | Yes | Yes (debounced, URL-backed) | 298 | Inbox/Outbox/My To-Do/All Tasks tabs; `?task=` deep link |
| tpi-masters | /tpi-masters/$id | modules/tpi-masters/routes/detail.tsx | DETAIL | none (form-grid) | No | No | 189 | inline delete-confirm; tier-gated |
| tpi-masters | /tpi-masters/$id/edit | modules/tpi-masters/routes/edit.tsx | FORM | none (delegates) | No | No | 118 | exit-confirm guard; tier-gated |
| tpi-masters | /tpi-masters | modules/tpi-masters/routes/list.tsx | LIST | `.innovic-table.tbl-grid` sheet | No | Yes (local debounced) | 389 | 7-col ruled sheet; `window.confirm` on delete |
| tpi-masters | /tpi-masters/new | modules/tpi-masters/routes/new.tsx | FORM | none (delegates) | No | No | 93 | tier-gated entry check |
| trash | /trash | modules/trash/routes/list.tsx | LIST (admin-only recovery register) | `.innovic-table` plain | No | No (type-filter select only) | 362 | `window.confirm` on restore/delete; `window.prompt("Type DELETE")` for Empty All |
| users | /users/new | modules/users/routes/create.tsx | FORM | none | No | No | 255 | react-hook-form; admin-only; role hard-coded to viewer |
| users | /users/$id/edit | modules/users/routes/edit.tsx | FORM | none | No | No | 405 | react-hook-form; inline delete confirm; separate password-reset panel |
| users | /users | modules/users/routes/list.tsx | LIST | `.innovic-table.tbl-grid` sheet | No | Yes (local debounced) | 476 | 9-col sheet; pagination Prev/Next |
| vendors | /vendors/$id | modules/vendors/routes/detail.tsx | DETAIL | none (form-grid) | No | No | 230 | inline delete confirm; rating badge; tier-gated |
| vendors | /vendors/new, /$id/edit | modules/vendors/routes/edit.tsx | FORM (one file, both routes) | none (delegates to VendorForm) | No | No | 187 | tier-gated |
| vendors | /vendors | modules/vendors/routes/list.tsx | LIST | `.innovic-table.tbl-grid` sheet | Yes | Yes (local debounced) | 583 | 11-col sheet; `window.confirm` on delete; Excel template + bulk import |

**Every one of the 138 route files in `router.tsx` is accounted for above.** (Batch totals: 34 + 35 + 36 + 33 = 138.)

---

## B. Group counts

### By pattern (all 138 routes)

| Pattern | Count | % |
|---|---:|---:|
| LIST | 41 | 30% |
| FORM | 37 | 27% |
| DETAIL | 26 | 19% |
| OTHER | 12 | 9% |
| REPORT/PRINT | 10 | 7% |
| DASHBOARD | 7 | 5% |
| SETTINGS/ADMIN | 5 | 4% |
| **Total** | **138** | |

`OTHER` (12 routes) is its own signal: these are screens that don't fit the four-pattern model at all and need bespoke templates or a 5th canonical pattern — `approvals`, `design-work-log`, `incoming-qc`, `job-queue`, `op-entry` (index), `production-schedule`, `qc-call-register`, `qc-documents`, `search`, `so-planning/workflow`, `so-status` (index), `tasks/board`.

### By module (routes per module, from `router.tsx` + directory listing)

4 routes: bom-master, cost-centers, delivery-challans, job-cards, nc-register, plans, production-orders, purchase-orders, qc-processes, route-cards, saved-reports, tpi-masters
3 routes: alerts, clients, goods-receipt-notes, invoices, items, job-work-orders, machines, operators, purchase-requests, sales-orders, users, vendors
2 routes: assembly, customer-dispatches, design-projects, jw-dc, op-entry, reports, so-costing, so-status
1 route: access-control, activity-log, approval-config, approvals, backup, daily-report, daily-task-reports, design-issues, design-tracker, design-work-log, incoming-qc, jc-ops, job-queue, machine-loading, op-log, party-grn, party-materials, pending-so-value, print-templates, production-dashboard, production-schedule, qc-call-register, qc-command, qc-documents, qc-history, raw-material, sc-dashboard, search, settings, so-cycle-time, so-overview, so-planning, stock-valuation, store-inventory, store-issues, stuck-dashboard, tasks, trash

69 modules total, matching the 138 route files (avg 2.0 routes/module).

### Table style (today)

| Style | Routes (direct) | Notes |
|---|---:|---|
| `.innovic-table.tbl-grid` sheet | 14 direct + ~6 via a delegated `*SheetTable` component (SO, PO, …) | the newest, closest-to-canonical look |
| `.innovic-table` plain (legacy list look) | ~70 | the majority — the "old unruled list look" the design system explicitly calls legacy |
| `.innovic-table.tbl-ctr` (centred variant) | 2 (sales-orders detail, and one of two styles on sales-orders list) | a **third, undocumented table look** not in the design system's "3 looks" inventory even — actually a modifier of plain |
| custom (cards, no `<table>`, or shadcn) | ~14 | delivery-challans, jw-dc, job-work-orders, nc-register, party-grn, purchase-requests, design-projects list, goods-receipt-notes list, all 4 saved-reports routes (shadcn) |
| none (form-grid pairs / fact strips only) | ~30 | every DETAIL screen with no line items, every thin FORM wrapper |

### StatStrip usage

Only **14 of 138 routes** import/use the shared `StatStrip` component directly: clients, customer-dispatches, delivery-challans, goods-receipt-notes, items, job-cards, nc-register (×2: detail + list), party-grn, production-orders, purchase-requests, store-inventory, tasks, vendors. Every other count/KPI row on the other ~35 screens that show one (dashboards, sc-dashboard, machine-loading, design-projects list, so-overview, qc-command, etc.) is a **hand-rolled `.stat-grid`/stat-card/KPI-tile look** — confirming `guidelines/consistency.html`'s "4 looks" divergence finding.

### Shared search

**Zero routes use the design system's `SearchInput` component** (`gs-wrap`/`gs-icon` classes are used only by the header's global search, `components/shared/global-search.tsx`). Roughly 90 of 138 routes have *some* local free-text filter, but every one is a hand-rolled `<input className="innovic-input">` wired to local/URL state — different widths, different placeholders, no search icon.

### Special dialogs

- `window.confirm`: 11 route files
- `window.alert`: 15 route files
- `window.prompt`: 3 route files (design-tracker, purchase-requests, trash — trash uses `prompt("Type DELETE")` for a bulk irreversible action)
- Every one of these should route through the design system's `ConfirmDialog` / `Banner` per the canonical rule ("Delete always goes through ConfirmDialog — never `window.confirm`").

---

## C. Per-pattern anatomy as it exists today

### LIST (41 routes) — three representative screens read in full

**1. `modules/job-cards/routes/list.tsx` (1037 LOC)** — closest to canonical.
Composition: `section-hdr` title row → real `StatStrip` import (`@/components/shared/stat-strip`) → List/Card view toggle (persisted to `useState`, not the canonical `ViewToggle`) → local debounced search `<input>` (not `SearchInput`) → machine/operator/date-range filter selects → `.innovic-table.tbl-grid` sheet (List view) with a bold-blue code column, colour-coded qty cells (green/amber/muted by coverage), row-click-to-detail → separate custom card renderer for Card view → count line. No `ListFooter`, no `ConfirmDialog` (delete goes through a separate row-action component). This is the single closest-to-canonical LIST in the codebase.

**2. `modules/jw-dc/routes/list.tsx` (1214 LOC)** — divergent: tabbed register + inline giant-modal forms.
Composition: two tabs (Outward/Inward) driven by local `useState`, each tab is its own `*View` component: `section-hdr` → plain `.innovic-table` (not sheet) → Prev/Next pagination via local `page` state (not URL) → "+ New DC" button opens an in-file modal component (`NewOutwardModal`, 313 lines; `NewInwardModal`, 326 lines) that duplicates a full create-form (date, PO/DC picker, vehicle no, remarks, line array) inside a `ModalShell`, rather than a route. No StatStrip, no shared search, no ConfirmDialog.

**3. `modules/qc-documents/routes/list.tsx` (1557 LOC)** — the largest LIST-family file, and genuinely three different screens wearing one route.
Composition: a 3-way `view` toggle (`matrix` / `register` / `status`, URL-driven) fans out to: (a) **MatrixView** — an SO picker (SearchableSelect) + a summary band + a table whose **columns are dynamic** (one per distinct QC op code returned by the API) with a filter-row built into `<thead>`, clicking a row opens a 400+-line `LineDetailModal` with nested upload sections; (b) **RegisterView** — an ordinary flat `.innovic-table` register with a category select + local search + an upload modal; (c) delegates to `SoQcStatusView` (a different component entirely) for the third tab. Three `window.confirm`/`window.alert` calls, an ad-hoc modal shell (not `Modal`), Excel export via `xlsx`.

**Divergence across the 41 LIST screens:**
- Table style splits three ways: sheet (`tbl-grid`, ~20 routes incl. via delegated `*SheetTable`), plain legacy `.innovic-table` (~15), and no table at all — a card register instead (delivery-challans, jw-dc's — no, cards: nc-register, party-grn, purchase-requests, job-work-orders, design-projects, goods-receipt-notes — 7 screens deliberately abandoned the table for cards, several per-file comments say this was to fix sideways-scroll bugs).
- Counts/filters: StatStrip (14), hand-rolled KPI strip (~15), StatusPills-style chips (~10), nothing (rest).
- Search: local un-styled `<input>` everywhere; URL-backed in about half, component-local `useState` in the other half (so a page refresh loses the filter on ~20 screens).
- Pagination: "scroll one fetch" (most masters), Prev/Next with URL `page=` (GRN, DC, op-log, activity-log, trash, store-issues, party-grn — the design system's own rule: "unbounded registers keep Prev/Next"), or client-side `page` state that resets when the tab remounts (jw-dc).
- Delete: `ConfirmDialog`-equivalent inline confirm-then-confirm UI on some (clients, cost-centers, machines, operators, vendors, tpi-masters, qc-processes detail), bare `window.confirm` on others (items, tpi-masters list, route-cards, job-work-orders, qc-processes list, design-tracker, design-work-log, trash, purchase-requests via prompt).

### FORM (37 routes) — three representative screens

**1. `modules/items/routes/edit.tsx` (197 LOC, real form 424 LOC) — the dominant pattern (≈20 of 37 FORM routes).**
The route file itself is a thin shell: access-tier gate → `useExitConfirm` → `<ItemForm mode="create|edit">`. This exact shape repeats for bom-master, clients, cost-centers, machines, nc-register, operators, purchase-requests, qc-processes, route-cards, sales-orders, tpi-masters, vendors, job-work-orders, purchase-orders (`PoForm`, `RouteCardForm`, `VendorForm`, etc. — all 1000+-line shared components). The route's job is only: perms gate, next-code fetch, exit-guard dialog, success navigation.

**2. `modules/production-orders/routes/new.tsx` (473 LOC) — a real, self-contained FORM, close to canonical shape.**
`panel-hdr` with title + read-only next-code preview → `form-grid form-grid-3` (NOT the canonical 12-col `FormGrid`) → a picker (`PlanPicker`) that triggers a **dependent-field cascade**: picking a Plan re-derives `targetDate`, refetches Route Cards scoped to the plan's item, and auto-selects the sole Route Card if there is exactly one → inline amber "blocked" banners (no route card / direct-purchase item) → Cancel/Submit buttons at the bottom (no sticky top Save/Cancel bar, unlike the canonical "section-hdr + Save/Cancel" pattern used in `SoForm`/`PoCompact`).

**3. `modules/delivery-challans/routes/create.tsx` (1273 LOC) — a multi-source wizard, furthest from canonical.**
Not a form at all in the canonical sense: a top-level `source` toggle (`po` | `nc`) renders one of two completely separate two-step flows — `PoDcSection` (picker table → `PoDcFormBody`, a ~270-line form with its own line-qty-capping logic) or `NcDcSection` (picker table → `NcDcFormBody`). Each "form" embeds its own picker `<table className="innovic-table">` with local search state, not `SearchableSelect`/`LineItemPicker`. No FormGrid, no shared Panel/line-table split — everything is bespoke flex/inline-style layout.

**Divergence across the 37 FORM screens:**
- ~20 are thin route wrappers around a shared `<XForm>` component (the good case — migrating the template only needs to touch the shared form component, not 20 route files).
- ~10 are self-contained forms with their own field-grid layout (`form-grid`/`form-grid-3`/`form-grid-4`, never the canonical 12-col `FormGrid`).
- 3 are multi-step wizards (delivery-challans/create, production-orders/close, goods-receipt-notes/new via `UnifiedGrnForm`) with picker→form flows that have no canonical equivalent at all.
- Exit-guard (`useExitConfirm`) is used on most but not all; a few (users/create, users/edit) have no exit guard.
- Dependent-field cascades appear in: production-orders/new (Plan→RouteCard), job-cards/edit (machine→group, vendor lookups), party-materials (Client→SO/JWSO→Item), delivery-challans (PO→sendable lines), goods-receipt-notes (line→QC-lock).

### DETAIL (26 routes) — three representative screens

**1. `modules/sales-orders/routes/detail.tsx` (689 LOC) — closest to canonical.**
`panel` with `panel-hdr` (code in blue mono + status badge + AssignTask/Status/Edit/Delete actions, delete is a two-step inline confirm not `ConfirmDialog`) → `panel-body` with a flex-wrap fact strip (`DetailGrid`/`StripItem` — the same *idea* as `ReadGrid`/`ReadField` but hand-rolled, not the 12-col grid) → a separate Client-PO file-upload bar panel → line-items `.innovic-table.tbl-ctr` (13 cols) → conditional milestones table → `RelatedDocsTabs` (already the canonical `RelatedDocs`-equivalent component) → an SO Documents section → an in-app `FilePreviewModal`. This is the screen closest to the target `DetailHeader(+ReadGrid) → Panels → RelatedDocs(+Timeline)` composition already.

**2. `modules/purchase-orders/routes/detail.tsx` (712 LOC).**
Same overall shape (panel-hdr → body → lines table → `RelatedDocsTabs`) but adds Approve/Reject action modals and a `PoHeaderBand` sub-component; line table is plain `.innovic-table`, not `tbl-ctr`.

**3. `modules/design-projects/routes/detail.tsx` (2127 LOC) — furthest from canonical.**
Not a single-panel detail at all: a header strip of `Tile`s (KPI-style, not `ReadGrid`) followed by a **4-tab workspace** (Tasks / Issues / Checklist / DCR‑DCN), each tab its own multi-hundred-line component with its own table, its own create/view modals (`TaskFormModal`, `ViewTaskModal`, `IssueFormModal`, `ViewIssueModal`, `DcrFormModal`, `DcnFormModal` — 6 bespoke modals in one file), a further DCR/DCN sub-tab-strip inside the 4th tab, and a `RelatedDocsPanel` tacked on at the very bottom almost as an afterthought. This is really a small application, not a document detail page.

**Divergence across the 26 DETAIL screens:**
- Master-with-no-lines DETAILs (clients, cost-centers, machines, operators, qc-processes, tpi-masters, vendors) already use a flat form-grid-pairs layout — cheapest to retarget onto `ReadGrid`/`ReadField`.
- Document DETAILs with line tables (SO, PO, PR, JWO, GRN, DC, BOM, route-cards, plans, so-costing) vary between `.innovic-table` plain and `.tbl-ctr`; none use `tbl-grid`.
- Several are actually workflow/status hybrids, not read views: `nc-register/detail` (dispose/close actions + StatStrip), `job-cards/status.tsx` (stat tiles + editable op-card strip + 4 tabs — effectively DASHBOARD+FORM+DETAIL in one), `assembly/detail` (Start/Stop/Undo action buttons), `production-orders/detail` (progressive-close ledger).
- `RelatedDocsTabs`/`RelatedDocsPanel` (already close to the canonical `RelatedDocs`) is used on: sales-orders, purchase-orders, design-projects, assembly (implied), goods-receipt-notes-adjacent flows — but NOT on plans, route-cards, bom-master, nc-register, job-work-orders, tpi-masters, vendors, clients, machines, operators, qc-processes, so-costing detail.

### DASHBOARD (7 routes) + REPORT/PRINT (10) + SETTINGS/ADMIN (5) — anatomy notes

DASHBOARD screens (`production-dashboard`, `sc-dashboard`, `alerts/dashboard`, `machine-loading`, `qc-command`, `stuck-dashboard`, `op-entry/running`) never use the canonical `StatStrip`/`WorkList`/`QuickLinks` — every one hand-rolls its own `.stat-grid`/stat-card/tile-grid CSS, then stacks 1–4 plain `.innovic-table`s below. `op-entry/running.tsx` (Live Operations Board) is the one screen already structurally closest to the design system's own `LiveOps` kit example (MachineCard grid + running table) — cheapest DASHBOARD migration.

REPORT/PRINT screens (`reports/list`, `reports/run`, `daily-report`, `qc-history`, `alerts/drill`, `pending-so-value`, `so-cycle-time`, `stock-valuation`, `print-templates/editor`, `saved-reports/run`) mostly follow filter-row → `.innovic-table` (sometimes with a `<tfoot>` totals row) → Export-Excel button; `saved-reports`' 4 routes are the one outlier built entirely on shadcn `Card`/`Table`, not Innovic's own component vocabulary at all.

SETTINGS/ADMIN screens (`access-control`, `alerts/config`, `approval-config`, `backup`, `settings`) are small form-grid/table admin panels with no consistent pattern between them; `access-control` opens a 1303-line modal per row.

---

## D. The canonical target (from `design-ref/README.md` + layout/data components)

Confirmed component tree, read directly from `design-ref/components/layout/*.jsx` and `design-ref/ui_kits/erp/*.jsx`:

**List** = `ListHeader` (title/count/search/tools/primary, sticky) → `StatStrip` **or** `StatusPills`(+`ViewToggle`) → `DataTable` (`variant="list"` for legacy look, else the ruled sheet `tbl-grid`, modifiers `frozen`/`auto`/`compact`/`edit`) **or** a `DocCard`+`LinesPanel` list → `ListFooter` (count text + optional Prev/Next + 💡 hint) → `ConfirmDialog` for delete. Seen fully assembled in `ui_kits/erp/SalesOrders.jsx`: `ListHeader` → `StatusPills` (right-docked `ViewToggle`) → sheet table with expandable ▸ rows **or** `DocCard` list → `ListFooter` → `ConfirmDialog`.

**Detail** = `DetailHeader` (code + badges + actions) `(+ReadGrid+ReadField)` → `Panel`(s) with `DataTable`/sheet line items → `RelatedDocs`(+`Timeline`, density regular/compact). Seen fully assembled in `ui_kits/erp/Screens2.jsx`'s `SoDetail`: `DetailHeader` with `ReadGrid`/`ReadField` (including a `QtyStrip` embedded as one "Quantities" field) → `Panel` with a `tbl-grid` line table → `RelatedDocs` sections + `Timeline density="compact"`.

**Create/Edit** = section-hdr + Save/Cancel (top, not bottom) → `Panel`(`FormGrid`, 12-col, `FormField size=xs/sm/md/lg/full`) → `Panel`(line table, `DataTable editable`) with a totals line → `ConfirmDialog` exit guard. Seen fully assembled in `SoForm.jsx`/`PoCompact` (`Screens2.jsx`): top bar with Cancel/Save, `Panel title="Order header"` with `FormGrid`+`DocNumberInput`+`SearchableSelect`, `Panel title="Line items"` with an editable `tbl-edit` table + a right-aligned total row, `ConfirmDialog` on Cancel.

**Dashboard** (not named in README's 3-way split but has its own kit example, `LiveOps` in `Screens2.jsx`) = `ListHeader`(icon/title/count, `sticky=false`) → `StatStrip` → a card/tile grid (`MachineCard`) → `Panel` with a `tbl-grid` table → `ListFooter` with a hint. `WorkList`/`AttentionList`/`StatRow`/`QuickLinks` (in `components/layout/WorkList.jsx`) are the canonical building blocks for a "my work" / "needs attention" dashboard panel, unused anywhere in the current app.

### Closest-to-canonical vs. furthest-away, per pattern

| Pattern | Closest (cheapest) | Why | Furthest (expensive) | Why |
|---|---|---|---|---|
| LIST | job-cards, clients, cost-centers, items, machines, operators, plans, qc-processes, route-cards, tpi-masters, users, vendors, bom-master (all already `tbl-grid`) | already on the sheet table; just needs `ListHeader`/`ListFooter`/real `SearchInput`/`ConfirmDialog` swapped in | qc-documents (3 views in 1 route, dynamic columns), so-planning/workflow (two-level workflow), jw-dc (tabs + 600-line inline modals), design-work-log (matrix table) | not a single list at all; needs re-scoping before a template even applies |
| DETAIL | sales-orders, purchase-orders (already panel-hdr → body → lines → RelatedDocsTabs) | RelatedDocsTabs already matches RelatedDocs; just needs DetailHeader/ReadGrid swap-in | design-projects (2127 LOC, 4 tabs, 6 modals), job-cards/status (stat tiles + editable op cards + 4 tabs) | these are small apps, not detail pages — need a bespoke "workspace" template, not DetailHeader |
| FORM | items, bom-master, clients, cost-centers, machines, vendors, tpi-masters, route-cards, qc-processes, nc-register, purchase-requests (thin wrapper → shared `<XForm>`) | fixing the ONE shared form component fixes N routes at once | delivery-challans/create (2-source wizard), production-orders/close (3-step picker), goods-receipt-notes/new (`UnifiedGrnForm`) | multi-step pickers have no canonical equivalent; need a new "wizard" pattern |
| DASHBOARD | op-entry/running (Live Operations Board — near-identical to the kit's own `LiveOps` example) | design system literally ships this exact screen as a worked example | production-dashboard (735 LOC, 4 disparate sections), sc-dashboard (663 LOC, 4 tables) | many independent sections stacked ad hoc, no single dashboard shape to retarget onto |
| REPORT/PRINT | reports/run, daily-report, qc-history (filter-row → table → export, already close to DataTable+ListFooter) | swap plain table for DataTable, done | print-templates/editor (1289-LOC WYSIWYG builder), saved-reports (shadcn, not Innovic components at all) | print-templates has no canonical equivalent in the kit; saved-reports needs a full re-skin off shadcn first |

---

## E. Migration ordering proposal

1. **Group 1 — "sheet" LIST masters (S, low risk).** clients, cost-centers, machines, operators, plans, qc-processes, route-cards, tpi-masters, users, vendors, bom-master, items, job-cards — 13 routes already on `tbl-grid`. Representative first migration: **`clients/routes/list.tsx`** (545 LOC, already has real `StatStrip`, already `tbl-grid`, no exotic pickers) — smallest possible diff to prove the `ListHeader`/`ListFooter`/`SearchInput`/`ConfirmDialog` wiring, then stamp the same diff across the other 12.

2. **Group 2 — thin-wrapper FORM masters (S–M, low risk, high leverage).** The ~14 `<XForm>`-delegating FORM pairs (new+edit) for the same 13 masters above, plus purchase-requests, sales-orders, job-work-orders, saved by fixing ONE shared form component per module. Representative first: **`modules/items/components/item-form.tsx`** (424 LOC) — rebuild onto `Panel`+`FormGrid`+`FormField`, then the 20 thin wrappers around similar forms follow the same recipe.

3. **Group 3 — flat-fact DETAIL masters (S, low risk).** clients, cost-centers, machines, operators, qc-processes, tpi-masters, vendors detail — 7 routes, no line tables, straight `ReadGrid`/`ReadField` swap. Representative: **`vendors/routes/detail.tsx`** (230 LOC).

4. **Group 4 — document DETAIL with lines (M).** sales-orders, purchase-orders, purchase-requests, job-work-orders, goods-receipt-notes, delivery-challans, bom-master, route-cards, plans, so-costing detail — 10 routes; most already have `RelatedDocsTabs`/`RelatedDocsPanel`. Representative first: **`sales-orders/routes/detail.tsx`** (689 LOC) — already closest to canonical, becomes the reference implementation the rest copy.

5. **Group 5 — document-with-lines LIST/register masters (M).** The ~15 plain-`.innovic-table` LIST screens with a real line-item structure (goods-receipt-notes, purchase-orders, purchase-requests, invoices, so-costing, store-inventory, store-issues, op-log, activity-log, design-issues, assembly). Representative: **`invoices/routes/list.tsx`** (250 LOC, smallest).

6. **Group 6 — card-register LIST screens (M, needs a decision first).** delivery-challans, jw-dc-adjacent, nc-register, party-grn, purchase-requests, job-work-orders, design-projects, goods-receipt-notes — 8 screens that deliberately abandoned tables for `DocCard`. Design system's own canonical List pattern explicitly supports `DocCard`+`LinesPanel` as an alternative to `DataTable`, so this is a real fit, not a detour — but confirm with the user whether the Card view stays default or the sheet table's `tbl-frozen`/`tbl-auto` modifiers now solve the original sideways-scroll problem, making Cards unnecessary. Representative: **`nc-register/routes/list.tsx`** (636 LOC, already has real `StatStrip`).

7. **Group 7 — DASHBOARD screens (M–L).** op-entry/running first (near-identical to the kit's own worked `LiveOps` example — validates the whole Dashboard recipe cheaply), then machine-loading, alerts/dashboard, stuck-dashboard, sc-dashboard, production-dashboard, qc-command (largest/most composite, last).

8. **Group 8 — REPORT/PRINT (M).** reports/run + reports/list first (already filter→table→export), then daily-report, qc-history, alerts/drill, pending-so-value, so-cycle-time, stock-valuation. Defer **saved-reports (4 routes, shadcn)** to its own mini-project — it needs a full re-skin off shadcn before the canonical layout components can even apply. Defer **print-templates/editor** (1289 LOC WYSIWYG builder) — no canonical equivalent exists yet; scope a new component first.

9. **Group 9 — SETTINGS/ADMIN (S–M).** backup, alerts/config first (small, single table); approval-config, settings next; access-control last (1303-line per-row modal needs its own redesign pass).

10. **Group 10 — multi-step FORM wizards (L, do last, one at a time).** delivery-challans/create, production-orders/close, goods-receipt-notes/new (UnifiedGrnForm) — each needs a new "wizard" template (picker step → form step) that doesn't exist in the design system yet; build it once against delivery-challans/create (the largest, most representative) and reuse for the other two.

11. **Group 11 — bespoke OTHER screens (L, do last, individually).** design-projects/detail (2127 LOC, 4-tab workspace), job-cards/status (dashboard+form+detail hybrid), qc-documents (3-view hybrid), so-planning/workflow (1583 LOC, 7 modal kinds), production-schedule (drag-drop Gantt), tasks/board (kanban), so-status/index (two-pane master/detail), qc-call-register, job-queue, incoming-qc, design-work-log (matrix table), approvals. Each is closer to a small standalone application than a page and will likely need a bespoke template proposed to the user before any migration starts — do not force-fit these into List/Detail/Form.

**Suggested global order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11** (cheapest/highest-leverage first, riskiest/most-bespoke last), with Group 11 items scheduled individually and reviewed with the user before starting each one, since they are the ones most likely to need new canonical patterns rather than reuse of existing ones.

---

## F. Screens with special risk

**Data-heavy tables (>15 columns or nested/expandable rows):**
- `op-log/routes/list.tsx` — **16 columns**, Planned-vs-Actual machine pair
- `so-planning/routes/workflow.tsx` — **16-column** fixed-layout line table
- `so-overview/routes/list.tsx` — 14-column list + **15-column drill-down** table
- `job-queue/routes/list.tsx` — 14 columns
- `jc-ops/routes/list.tsx` — 14 columns
- `incoming-qc/routes/index.tsx` — 11- and 14-column tables
- `qc-documents/routes/list.tsx` — dynamic column count (one per QC op code, unbounded)
- Nested/expandable rows: `bom-master/routes/list.tsx` (▸ reveals nested part-list table), `route-cards/routes/list.tsx` and `route-cards/routes/detail.tsx` (expandable revision-history rows reveal a snapshot ops table), `sales-orders/routes/list.tsx` (▸ reveals per-SO line-item sub-table), `job-cards/routes/list.tsx` (card view + expandable), `so-overview/routes/list.tsx` (row click swaps the whole list for a drill-down)

**Forms with dependent-field cascades:**
- `production-orders/routes/new.tsx` — Plan → auto-fills target date, scopes/refetches Route Cards, auto-selects sole match
- `job-cards/routes/edit.tsx` (status.tsx edit branch, via `jc-op-edit-card.tsx`) — machine → machine-group, vendor-code lookups
- `party-materials/routes/list.tsx` (inline Add/Edit modal) — Client → SO/JWSO → Item cascading picker
- `delivery-challans/routes/create.tsx` — PO selection → sendable-lines cap computed per line
- `goods-receipt-notes/routes/edit.tsx` — line QC-completion locks fields dynamically

**Print views:**
- `print-templates/routes/editor.tsx` (1289 LOC, WYSIWYG template builder — admin-only, no canonical equivalent)
- `invoices/routes/detail.tsx` (A4 print-preview via `dangerouslySetInnerHTML`)
- `daily-report`, `machine-loading`, `delivery-challans` (list+detail), `goods-receipt-notes/detail`, `jw-dc/detail`, `qc-documents` — all use `window.print()` + popup-blocked `window.alert` fallback rather than a shared `PrintDocument` flow

**`window.confirm`/`window.alert`/`window.prompt` (bypasses the canonical `ConfirmDialog`/`Banner`):**
- `window.confirm` (11 files): bom-master/detail, design-projects/detail, design-tracker/list, design-work-log/list, party-materials/list, print-templates/editor, purchase-requests/list, qc-documents/list, route-cards/detail, route-cards/list, trash/list
- `window.alert` (15 files): customer-dispatches/list, daily-report/list, delivery-challans/detail+list, goods-receipt-notes/detail, invoices/detail, items/detail, jw-dc/detail, machine-loading/list, party-materials/list, print-templates/editor, purchase-orders/detail, qc-documents/list, route-cards/detail+list
- `window.prompt` (3 files): design-tracker/list, purchase-requests/list ("Reject" reason), **trash/list ("Type DELETE" for Empty All — an irreversible bulk action gated only by a native browser prompt)**

**Bespoke CSS / non-standard component systems:**
- `saved-reports/*` (4 routes) — built entirely on shadcn `Card`/`Table`, not one Innovic class anywhere
- `machine-loading/routes/list.tsx` — its own `.mach-card` inline styling, "not ported to theme" per its own code comment
- `production-schedule/routes/list.tsx` — fully bespoke inline-style Gantt grid + native HTML5 drag-and-drop, no `.innovic-table` at all
- `design-projects/routes/list.tsx` — bespoke CSS-grid card layout, no table

**Realtime/live screens (state-sync risk during a template swap):**
- `op-entry/routes/index.tsx` and `op-entry/routes/running.tsx` — Supabase Realtime subscriptions for running ops / op log

**Largest files overall (review effort, not just template effort):**
design-projects/detail (2127), so-planning/workflow (1583), qc-documents/list (1557), print-templates/editor (1289), delivery-challans/create (1273), jw-dc/list (1214), jc-ops/list (1121), design-work-log/list (1121), design-tracker/list (1050), job-cards/list (1037).
