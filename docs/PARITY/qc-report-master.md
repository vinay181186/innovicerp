# PARITY — Report / Document Master (`renderReportMaster`)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L23677–23715 (`renderReportMaster`, `addReportType`, `editReportType`, `delReportType`).
> **React target:** `apps/web/src/modules/report-types/` (route `/report-master`). API `modules/report-types`. `report_types` table (migration `0038`).

---

## Verdict: BUILT ✅ — simple master CRUD

Report/document types that appear as QC document-requirement options in SO/JW Planning. Mirrors QC Process Master's shape.

### Table (legacy 6 cols)
\# · Report/Document Name (purple bold) · Description · Default (★ Mandatory / Optional badge) · Status (Active/Inactive badge) · Actions (Edit · Del). ✅

### Form (`addReportType`)
Name★ · Description · Default Requirement (Mandatory/Optional) · Status. ✅ (inline modal).

### Backend
`report_types` (migration 0038): name, description, default_mandatory, status + standard cols + RLS (read all, write admin/manager/qc). CRUD: list / create / update / soft-delete.

### Note
Header info banner mirrors legacy ("Define report/document types… appear in SO/JW Planning"). Wiring into the SO/JW Planning QC-doc-requirement picker is a Planning-module follow-up (legacy uses these as options there).
