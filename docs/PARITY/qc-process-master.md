# PARITY — QC Process Master (`renderQCProcessMaster`)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L23446–23513 (`renderQCProcessMaster`, `addQCProcess`/`editQCProcess`/`delQCProcess`).
> **React target:** `apps/web/src/modules/qc-processes/routes/list.tsx` (route `/qc-processes`). Already legacy-chrome.

---

## Verdict: at parity ✅ (1 deliberate unit DELTA)

### Table columns
| # | Legacy (L23470) | React | Match? |
|---|---|---|---|
| 1 | # | # | ✅ |
| 2 | QC Process Name (green bold) | QC Process Name | ✅ |
| 3 | Description | Description | ✅ |
| 4 | **Std Time (h)** (`defaultCycleTime` hrs) | **Std time (min)** (`defaultCycleTimeMin`) | ⚠️ **DELTA — unit** |
| 5 | Status (badge Active/Inactive) | Status | ✅ |
| 6 | Actions (Edit · Del) | Actions | ✅ |

- **Unit DELTA:** legacy stores cycle time in **hours**; our normalized schema stores **minutes** (`default_cycle_time_min`), so the React column reads "min". Deliberate model choice (consistent with `jc_ops.cycle_time_min`) — not a bug. Leave as-is.

### Header + entry
- "⚙ QC Process Master" + "+ Add QC Process" (admin/manager). ✅
- Info banner ("Define QC inspection processes…"). ✅
- Form: Name★, Description, Default Cycle Time, Status. ✅

No action required.
