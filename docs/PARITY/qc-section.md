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

## Build waves (by tractability)

- **Wave 1 — verify/refactor existing 3:** qc-dashboard (qcengineer) chrome refactor + parity; nc-register parity; qc-processes parity.
- **Wave 2 — registers/entry (backend-light, reuse qc_inspections/op_log/grn):** Incoming QC, QC Call Register, QC History, QC Documents.
- **Wave 3 — CAPA:** capa_records CRUD (table exists).
- **Wave 4 — overview dashboards:** QC Command Center, SO QC Status (aggregation over qc stages).
- **Wave 5 — TPI Inspection, Report Master:** if distinct from existing modules (TPI may be a sub-mode of qc_inspections; Report Master likely the Reports module).

## Cross-cutting
- Several pages read the same `qc_inspections` / op_log QC entries — check the existing qc-dashboard service before adding new aggregation endpoints (reuse).
- QC Reports + Report Master likely fold into the existing `reports` module rather than new pages.
