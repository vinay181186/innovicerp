# PARITY — Cross-cutting Reports (Stuck Dashboard · SO Cycle Time · Time Tracker)

> Source: `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html`
> Render fns read directly: `renderStuckDashboard` (18017), `renderSOCycleTime` (18176),
> `renderTimeTracker` (18954), shared engine `_soPhaseData` (17870), `_stuckThresholds` (17997),
> `_dsnTotalHours` (7338).
> Sidebar group: **Reports** (currently `/reports`, `/saved-reports`). These add 3 routes.

These three screens are read-only aggregations. Two of them (Stuck, Cycle Time) share one
engine: **`_soPhaseData(soNo)`** — per SO it derives a set of phase timestamps and the day-gaps
between them.

---

## Shared engine — SO phase data

For each non-deleted SO header, derive these phase timestamps (legacy field → our source):

| Phase | Legacy source | Our source |
| --- | --- | --- |
| `so_created` | salesOrders.soDate | `sales_orders.so_date` |
| `design_assigned` | designTracker.createdAt/startDate | `design_tracker.start_date` (by `sales_order_id`) |
| `design_approved` | designTracker.approvedAt when status Approved | `design_tracker.approved_at` when `status='Approved'` |
| `bom_linked` | bomMasters.revisionDate/createdAt | `bom_masters.created_at` via `sales_orders.bom_master_id` |
| `plan_created` | plans.createdAt | `plans.created_at` (by `sales_order_id`/line) min |
| `jc_created` | jobCards.date min | `job_cards.created_at` min (JCs of this SO) |
| `pr_raised` | purchaseRequests.prDate min | `purchase_requests` linked to SO, min date |
| `grn_received` | grn.grnDate max (POs of SO) | `goods_receipt_notes.grn_date` max for SO-linked POs |
| `first_op_start`/`last_op_end` | opEntries (non-QC) min/max date | `op_log` where `log_type IN (start,complete)`, min/max `log_date` |
| `first_qc_start`/`last_qc_end` | opEntries (QC) min/max | `op_log` where `log_type='qc'`, min/max `log_date` |
| `assembly_started`/`assembly_done` | assemblyUnits.date min/max | `assembly_units.assembly_date` min/max (by `sales_order_id`) |
| `dispatched` | dispatchLog.date max | **`assembly_units.dispatch_date` max where `dispatched=true`**, else `sales_orders.status IN (dispatched,closed)` → `updated_at` (fallback) |
| `invoiced` | invoices.invoiceDate max | `invoices.invoice_date` max (by SO) |

Durations (whole days, `round((d2-d1)/86400000)`, null if either end missing) — identical to legacy:
`design`, `design_to_plan`, `plan_to_jc`, `material_proc` (pr→grn), `production` (firstOp→lastOp),
`qc` (firstQc→lastQc), `assembly`, `assembly_to_dispatch`, `total` (so_created → dispatched||invoiced).

**JC linkage to SO:** our `job_cards` reference SO lines; resolve SO → its lines → JCs → `jc_ops` → `op_log`.

---

## Screen 1 — Stuck Activity Dashboard (`/stuck-dashboard`)

Scans active SOs (status not closed/cancelled, not yet dispatched). For each, flags a phase as
**stuck** when its elapsed days exceed a configurable threshold. Legacy thresholds (defaults, days):

```
design 15 · design_to_plan 3 · plan_to_jc 2 · material_proc 10
production_op 5 · qc 3 · assembly 5 · assembly_to_dispatch 2
```

Stuck rules (legacy verbatim):
- **Design** — design_assigned set, design_approved not, days > `design`.
- **Planning** — (design_approved||bom_linked) set, plan_created not, days > `design_to_plan`.
- **JC Creation** — plan_created set, jc_created not, days > `plan_to_jc`.
- **Material Procurement** — pr_raised set, grn_received not, days > `material_proc`.
- **Production Op** — per open op with available qty pending, days since last op_log entry > `production_op`.
- **QC Pending** — per QC op with pending qty, days since last entry > `qc`.
- **Assembly** — assembly_started, not assembly_done, days > `assembly`.
- **Dispatch Pending** — assembly_done, not dispatched, days > `assembly_to_dispatch`.

UI: summary tiles (Total Stuck / Critical >5d-over / Stages Affected); items **grouped by stage**,
each group a `.panel` table sorted by most-over-threshold; SO links to its timeline. Empty state =
"All activities on track". Thresholds configurable (legacy modal `_stuckThresholdsEdit`).

**Threshold storage:** legacy keeps in `db.stuckThresholds`. We have no such table. → **store in
`system_settings`/config key** if one exists, else accept defaults read-only for v1 (see decision).

## Screen 2 — SO Cycle Time Report (`/so-cycle-time`)

All SOs (filterable: All / Completed / Active / Equipment / Job Work + text search). Per SO a row of
phase durations; top tiles show **averages** across the filtered set (Design / Production / QC /
Assembly / Total). Cell coloring: >10d amber, >20d red; total > avg = amber. Green row = dispatched.
Excel export of the full phase+duration matrix. Clicking SO → timeline.

## Screen 3 — Time Tracker Dashboard (`/time-tracker`) — DEFERRED (2026-06-02)

> **Deferred by user direction 2026-06-02:** `op_log` has no hours-worked field, so Production/QC
> hours can't be sourced faithfully. Build later "if required" once hours-capture exists. Only
> Stuck Dashboard + SO Cycle Time ship in this batch. Spec retained below for when it's revived.


Period filter (7/30/365/all days). Pulls time entries from:
- **Design** — `design_time_log` (date, worker, hours, design, SO). ✅ fully available.
- **Production/QC** — legacy reads `opEntries.hoursWorked`. **We do not store hours-worked on
  `op_log`.** → see DECISION below.

Tabs: **By Person**, **By SO**, **By Design (estimate vs actual variance)**, **Daily Log** (recent 500).
Summary tiles: Total / Design / Production / QC hours + entry count. Excel export.

The "By Design" tab needs actual hours per design = `SUM(design_time_log.hours)` per `design_tracker`
(legacy `_dsnTotalHours`), vs `design_tracker.estimated_hours`. ✅ fully available.

---

## DELTAS / decisions to confirm before build

1. **Time Tracker production/QC hours** — `op_log` has no `hours_worked`. Options:
   - **(A) Design-only:** Production/QC columns show 0/— with a footnote "production hours not
     captured." Simplest, honest, stays in reports module.
   - **(B) Derive from `running_ops`:** production hours = `ended_at − (start_date+start_time)`
     elapsed per operator. QC stays 0 (point-in-time logs). More useful; elapsed ≠ worked.
   - **(C) Add `hours_worked` to `op_log` + Op Entry form** — true parity, but a migration + touches
     the op-entry module (out of "build report" scope).

2. **Stuck thresholds persistence** — no `stuck_thresholds` store today. v1 ships with the legacy
   defaults (read-only / hardcoded constants); a config-backed editor can follow. Confirm OK.

3. **Dispatch timestamp** — primary source `assembly_units.dispatch_date`; SOs without assembly units
   fall back to SO `status` flag + `updated_at`. Faithful for assembled equipment; approximate for
   pure component SOs that skip assembly.

## Build plan (3 modules, read-only, per Section 4)

- `lib/so-phase-data.ts` (api) — shared query+compute engine; consumed by both stuck & cycle-time services.
- Modules: `stuck-dashboard`, `so-cycle-time`, `time-tracker` — each `service.ts`+`routes.ts`+tests
  (api) and `api.ts`+`routes/*.tsx` (web), sidebar links under Reports. UI uses
  `.panel`/`.innovic-table`/tiles per UI-003. Excel export client-side (mirror existing report exports).
- No schema migration (unless decision 1C or 2-with-store is chosen).
