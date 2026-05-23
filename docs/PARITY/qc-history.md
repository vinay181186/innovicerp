# PARITY — QC History & Tracking (`renderQCHistory`)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L23531–23632.
> **React target:** `apps/web/src/modules/qc-history/` (route `/qc-history`). API `modules/qc-history` (read-only). Built QC Wave 2 — no migration.

---

## Verdict: BUILT ✅

Read-only over `op_log` (log_type='qc') + `v_jc_op_status`. No new table.

### Header + tabs
- "📊 QC History & Tracking" + **All / Pending / Completed** tab toggle. ✅

### Stats (legacy 4, L23604–23608)
Pending QC Ops · Overdue (>1 day) · QC Entries (total) · Today. ✅

### Filters (L23611–23618)
SO/JC/Item search + Date From + Date To + Clear. ✅ (client-side, like legacy).

### Pending QC table (12 cols, L23625)
JC · Op · SO · Item · Operation · Order · Done · Accepted · Rejected · Pending · Since (⚠ if overdue) · [🔬 QC → /qc-dashboard]. ✅

### Completed QC entries table (L23629)
JC · Op · SO · Item · Operation · Accepted · Rejected · Date · Shift · Inspector · Remarks. ✅
- Legacy also has a **Report** column (📎 QC report image) — **DELTA**: our op_log has no per-log report attachment; deferred.

### Remaining (DELTA / POLISH)
- **Excel export** (legacy `_qcExportExcel` via SheetJS) — Export Completed / Pending buttons. Deferred.
- Per-log QC **Report** attachment column (needs an attachment source).
- Completed logs capped at 500 most-recent (legacy shows all); date filter narrows.
