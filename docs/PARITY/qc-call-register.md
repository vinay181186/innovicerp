# PARITY — QC Call Register (`renderQCDashboard`, page `qcdashboard`)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L4126–4250 (`renderQCDashboard`), inline submit `qcdSubmit`, `qcdOpen`.
> **React target:** `apps/web/src/modules/qc-call-register/` (route `/qc-call-register`). **Frontend-only** — reuses the `qc-history` endpoint for data + op-entry `submitQcLog` for the write. No new backend, no migration.

---

## Verdict: BUILT ✅

Distinct from `qcengineer` (QC Dashboard, `_pageTitles` L2219). 2-panel split.

### LEFT — QC Pending Calls
- Header: pending count + (search). ✅
- Each pending op (qc_required/qc op + qc_pending>0): JC · Op · item — operation · SO | Produced | Order · "Since" + overdue ⚠ · big PENDING qty. ✅
- Click → **inline QC Entry form**: Date · Shift · Accept Qty (≤ pending) · Reject Qty · Inspector · Remarks · **✓ Submit QC** → reuses `submitQcLog` (same write as op-entry QC sub-form; bounds accept+reject ≤ pending). ✅
- **DELTA:** legacy `qcCallDate` (jc_ops.qc_call_date) → we use `pendSince` (last complete log_date) as the waiting-since proxy. Report attachment on submit deferred (POLISH).

### RIGHT — QC Completed Log
- Header: complete count + today count + (search). ✅
- Last 30 QC logs: JC · Op — operation · item · SO · accepted ✓ / rejected ✗ · date · shift · inspector · remarks. ✅
- **DELTA:** legacy shows Called→Attended response days + logNo + report link; we show date/shift/inspector/remarks (logNo + report attachment not in our op_log read).

### Remaining (POLISH)
- Per-call panel search boxes (legacy filters the lists client-side); the lists are short enough that this is low-value.
- QC report image attach on submit (needs an attachment store).
