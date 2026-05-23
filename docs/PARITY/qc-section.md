# PARITY — QC / Quality Section (consolidated)

> Legacy source: `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html`. Sidebar QC menu = L472–490. Goal (2026-05-23): map every QC page from HTML, map remaining differences, build same as HTML. Build directly, no commit prompts; ask only on data conflicts; full-module testing at the end.

Canonical QC menu (legacy sidebar L474–489), grouped Entry / Master / Report:

| # | Menu label | nav page | legacy fn | React route | Status |
|---|---|---|---|---|---|
| 1 | Incoming QC | `incomingqc` | `renderIncomingQC` L23748 | — | ❌ missing |
| 2 | NC Register | `ncregister` | `renderNCRegister` L22494 | `/nc-register` | ✅ exists (verify) |
| 3 | CAPA | `capa` | `renderCAPA` L22779 | — | ❌ missing |
| 4 | QC Call Register | `qcdashboard` | `renderQCDashboard` L4126 | — | ❌ missing |
| 5 | TPI Inspection | `tpi` | `renderTPI`? | — | ❌ missing |
| 6 | QC Process Master | `qcprocessmaster` | `renderQCProcessMaster` L23446 | `/qc-processes` | ✅ exists (verify) |
| 7 | Report Master | `reportmaster` | `renderReportMaster` | — | ⚠️ likely Reports module |
| 8 | QC Dashboard | `qcengineer` | `renderQCEngineerDash` L3963 | `/qc-dashboard` | ✅ exists (verify + chrome refactor) |
| 9 | QC Command Center | `qccommand` | `renderQCCommandCenter` L18613 | — | ❌ missing |
| 10 | SO QC Status | `soqcstatus` | `renderSOQCStatus` L18347 | — | ❌ missing |
| 11 | QC History | `qchistory` | `renderQCHistory` L23531 | — | ❌ missing |
| 12 | QC Documents | `qcdocs` | `renderQCDocuments` L23039 | — | ❌ missing |
| 13 | QC Reports | `rpt_qc` | (grouped reports) | `/reports?group=QC` | ⚠️ Reports module |

> Note: React `/qc-dashboard` = legacy **qcengineer** ("QC Dashboard", `_pageTitles` L2219), NOT `qcdashboard` ("QC Call Register"). The Call Register is a distinct unbuilt page.

Per-page detail: `qc-{incoming,nc-register,capa,call-register,tpi,process-master,engineer-dash,command-center,so-qc-status,history,documents}.md`.

Backend QC tables (per SCHEMA.md): `qc_inspections`, `qc_attachments`, `nc_register`, `capa_records`. Existing API modules: `qc-dashboard`, `qc-processes`, `nc-register`.

---

## Build waves (by tractability) — backend confirmed 2026-05-23

QC inspection data lives in **`op_log` (log_type='qc')** + **`goods_receipt_note_lines` qc fields**. There is **no `qc_inspections` and no `capa_records` table**.

- **Wave 1 — DONE:** qc-dashboard (qcengineer) chrome refactor (`6854672`); nc-register + qc-processes mapped/verified (`697f159`).
- **Wave 2 — NO MIGRATION (most tractable):**
  - **Incoming QC** — GRN lines already have `qc_status`/`qc_accepted_qty`/`qc_rejected_qty`/`qc_date`/`qc_remarks`. ✅ buildable now.
  - **QC History** — read `op_log` qc entries. ✅ buildable now.
  - **QC Call Register** (`qcdashboard`) — qc-pending ops + log-QC action (op_log). Mostly reuses op-entry QC write.
- **Wave 3 — MIGRATION:** **CAPA** (new `capa_records` table) — coordinate migrations.
- **Wave 4 — aggregation (no migration):** QC Command Center, SO QC Status (roll up qc stages over op_log qc + grn qc).
- **Wave 5:** QC Documents (needs an attachments source — check `qc_attachments`/storage), TPI Inspection, Report Master (likely the Reports module).

## Cross-cutting
- Reuse the existing `qc-dashboard` service aggregation pattern before adding new endpoints.
- QC Reports + Report Master likely fold into the existing `reports` module rather than new pages.
