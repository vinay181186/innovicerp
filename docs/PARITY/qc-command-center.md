# PARITY — QC Command Center (`renderQCCommandCenter`)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L18613–18732+ (`renderQCCommandCenter`, `_qccQueueData`, `_qccFPYData`, `_qccPickUp`, `_qccAssign`, tab renderers).
> **React target:** `apps/web/src/modules/qc-command/` (route `/qc-command`). **Frontend-only** — composes the existing `/qc-history` (pending) + `/qc-dashboard` (inspector perf, rejection reasons, rates) endpoints. No new backend.

---

## Verdict: BUILT ✅ — full parity (5/5 tabs, Pick-Up/Assign) as of 2026-05-24

5-tab QC control board with a top stats strip. Backed by the new `qc-command`
backend module (`GET /qc-command` analytics + `POST /qc-command/{pickup,assign}`)
over `op_log` QC groups + `qc_assignments` (migration 0040). Pareto + Inspector
tabs still reuse `/qc-dashboard`.

### Stats strip
QC Pending · Overdue · Oldest (age) · **Rework Items** · **First-Pass Yield %** — now matches legacy (was Month Acceptance / Inspected Today). From `qc-command.stats`.

### Tabs
| Tab | Status | Source |
|---|---|---|
| **QC Queue** | ✅ full | `qc-command.queue` — Age · JC/Op · Operation · SO/Customer · Qty · **Attempt** · Due · **Assigned To** · **Actions (Pick Up / Assign)**; sortable age/due/customer |
| **First-Pass Yield** | ✅ full | `qc-command.fpy` — by Operation + by Inspector (side-by-side) + lowest-FPY items. FPY = op passed on 1st attempt with 0 rejects (legacy rule) |
| **Rejection Pareto** | ✅ full | qc-dashboard `topRejectionReasons` (count + share bar) |
| **Inspector Performance** | ✅ full | qc-dashboard `engineerPerf` (calls/accept/reject/rate/avg-resp) |
| **Rework Cycles** | ✅ full | `qc-command.rework` — JC/Op · Item · SO · Attempts · Total Rejected · First/Last Entry · Days Elapsed |

### Pick-Up / Assign
- **Pick Up** (any admin/manager/qc) — assigns the op to the caller; one-click, optimistic refetch.
- **Assign** (admin only) — modal picks any active inspector + optional note. Service enforces admin for assign-to-another; RLS gates the table to admin/manager/qc.
- `qc_assignments`: one active row per op (partial unique index); pick-up / re-assign upserts.

### Minor DELTA (backlog, not blocking)
- Inspector Performance "Current Load" column (legacy `_qccRenderInspector` adds per-inspector assigned-queue count). The `qc_assignments` data now exists to compute it; the tab still reads `/qc-dashboard` which doesn't surface workload. Fold in when Inspector tab moves onto `qc-command`.
