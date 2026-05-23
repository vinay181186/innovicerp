# PARITY — QC Command Center (`renderQCCommandCenter`)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L18613–18732+ (`renderQCCommandCenter`, `_qccQueueData`, `_qccFPYData`, `_qccPickUp`, `_qccAssign`, tab renderers).
> **React target:** `apps/web/src/modules/qc-command/` (route `/qc-command`). **Frontend-only** — composes the existing `/qc-history` (pending) + `/qc-dashboard` (inspector perf, rejection reasons, rates) endpoints. No new backend.

---

## Verdict: BUILT ✅ (3 of 5 tabs full; FPY + Rework partial)

5-tab QC control board with a top stats strip.

### Stats strip
QC Pending · Overdue · Oldest (age) · Month Acceptance % · Inspected Today. ✅ (from qc-history.stats + qc-dashboard.summary).

### Tabs
| Tab | Status | Source |
|---|---|---|
| **QC Queue** | ✅ full | qc-history pending (sorted oldest-first): Age · JC/Op · Operation · Item · SO · Pending |
| **Rejection Pareto** | ✅ full | qc-dashboard `topRejectionReasons` (count + share bar) |
| **Inspector Performance** | ✅ full | qc-dashboard `engineerPerf` (calls/accept/reject/rate/avg-resp) |
| **First-Pass Yield** | ⚠️ partial | shows month acceptance % as a proxy + note; true FPY (passed on 1st attempt) needs per-op QC-attempt history |
| **Rework Cycles** | ⚠️ partial | note — needs per-op QC-attempt index (1st/2nd/3rd); NC Register shows rework dispositions today |

### Deferred (DELTA)
- **Pick Up / Assign** queue actions — need a `qc_assignments` table (legacy `db.qcAssignments`). Queue is read-only for now.
- **FPY + Rework** attempt-level analytics — derive a per-op attempt index from `op_log` QC entries (follow-up). Largely overlaps the already-built **QC Dashboard** (engineer rates + rejection reasons).
