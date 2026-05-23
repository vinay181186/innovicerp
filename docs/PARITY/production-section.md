# PARITY — Production Section (master matrix)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html`
> **Skill applied:** `legacy-canonical-mapper` — 1:1, no invention.
> **Compiled:** 2026-05-23 (user flagged "miss lots of thing" — full re-audit).

The Production dept has **15 sidebar entries in 3 groups** (legacy HTML L451–471). The previous summary listed only 7 — this is the full re-audit.

---

## Sidebar mapping (legacy L451–471 verbatim)

### Entry (4)
| # | key | label | render fn | React route | Status |
|---|---|---|---|---|---|
| 1 | `opentry` | ✚ Op Entry | `renderOpEntry` L5202 | `/op-entry` | ✅ SHIPPED |
| 2 | `machopentry` | ⚙ Machine Op Entry | `renderMachOpEntry` L5540 | `/op-entry/machines` | ✅ SHIPPED |
| 3 | `jcops` | ⨯ JC Operations | `renderJCOps` L11349 | — | ❌ **MISSING** |
| 4 | `dailyreport` | 📊 Daily Report | `renderDailyReport` L10823 | — | ❌ **MISSING** |

### Master (3)
| # | key | label | render fn | React route | Status |
|---|---|---|---|---|---|
| 5 | `jobcards` | ▭ Job Cards | `renderJobCards` L5739 | `/job-cards` | ✅ SHIPPED |
| 6 | `machines` | ⚙ Machine Master | `renderMachines` L13070 | `/machines` | ✅ SHIPPED |
| 7 | `operators` | 👷 Operator Master | `renderOperators` L13699 | `/operators` | ✅ SHIPPED |

### Report (8)
| # | key | label | render fn | React route | Status |
|---|---|---|---|---|---|
| 8 | `dashboard` | 📊 Production Dashboard | `renderDashboard` L3658 (global) | `/production-dashboard` | ⚠️ React has own page; legacy reuses global dashboard |
| 9 | `shopfloor` | 🏭 Shop Floor | `renderShopFloor` L10286 | — | ❌ **MISSING** |
| 10 | `jobqueue` | ⬛ Job Queue | `renderJobQueue` L10363 | — | ❌ **MISSING** |
| 11 | `loading` | ▣ Machine Loading | `renderLoading` L5021 | `/machine-loading` | ✅ SHIPPED |
| 12 | `prodschedule` | 📅 Production Schedule (Gantt) | `renderProductionSchedule` L15588 | — | ❌ **MISSING** (largest) |
| 13 | `prodsolist` | 📋 SO List | `renderProdSOList` L22954 | — | ❌ **MISSING** |
| 14 | `prodjwlist` | 📋 JW List | `renderProdJWList` L22995 | — | ❌ **MISSING** |
| 15 | `rpt_production` | 📊 Production Reports | `renderDeptReport('production')` (L20020) | `/reports?group=Production` | ⚠️ No reports tagged `group:'Production'` yet (legacy reuses Item Tracker + SO Line Tracker from Sales) |

**Total gap:** 7 missing pages + 7 sidebar entries to add + 1 dashboard parity check + 1 reports-group tagging.

---

## Build plan (this session)

Ordered smallest-first by isolation. All slices land before commit.

### Slice A — Sidebar parity + Production reports group

- Add the 7 missing sidebar entries (legacy L453–470 order) in `apps/web/src/components/shared/sidebar.tsx`.
- Tag `item-tracker` + `so-open-backlog` with an additional `group: 'Production'` registration (duplicate registry entries with the Production group label). Matches legacy L20020.

### Slice B — SO List + JW List (read-only, smallest pages)

Per `renderProdSOList` L22954 + `renderProdJWList` L22995.

- `/prod-so-list` — production view of SOs grouped by SO no.: SO No / Customer / Type / Lines / Total Qty / Done (last-op qty rollup) / Balance / Progress bar / Due Date.
- `/prod-jw-list` — mirrors SO List for JW orders (no Type column).
- Both backed by aggregations over `sales_orders` + `sales_order_lines` + (optionally) `v_jc_status`.

### Slice C — Daily Report

Per `renderDailyReport` L10823.

- `/daily-report?date=YYYY-MM-DD&machine=<machineId>` — date + machine pickers (URL state).
- 4-tile KPI strip: Total Pieces / Log Entries / Machines Active / Job Cards Active.
- Per-machine panel with 9-col table (JC No / Item Code / Item Name / Op / Operation / Shift / Qty Produced / Operator / Remarks).
- Backed by `op_log` filtered by `log_date` + (optionally) by machine via JC op join.

### Slice D — JC Operations

Per `renderJCOps` L11349.

- `/jc-ops` — full enriched-ops list across all JCs.
- 14-col table: JC No / Item / Op Seq / Machine / Operation / Cycle / QC / Order / Input / Done / Available / Pend Hrs / Status / Actions.
- JC filter dropdown (All + each unique JC code).
- Per-row badges:
  - 🏭 OUTSOURCE chip with status colour (Pending / PR Raised / PO Created / Sent / Received / Done)
  - [OSP] chip with vendor name for in-house OSP operations
- "Change Machine" action only for Waiting/Available ops (read-only otherwise).
- Reuses calc-engine `enrichOps` already built for SO Status (PL-1 slice).

### Slice E — Shop Floor

Per `renderShopFloor` L10286.

- `/shop-floor` — live `running_ops` grouped by machine.
- Top status-card row: one per machine with `▶ N running` (amber) or `⚫ Idle` (gray).
- Per-machine panel:
  - amber-tinted header when running, gray when idle
  - 14-col table: JC No / Op / Operation / Item Code / Item Name / SO-WO / Order / Done / Pending / Priority / Due / Operator / Started / Stop button
- "Stop" action marks the running_ops row done.
- Empty state when no machines have active runs.

### Slice F — Job Queue

Per `renderJobQueue` L10363.

- `/job-queue?machine=<machineId>` — pending ops per machine with manual reorder.
- Top machine-cards strip (click to filter to one machine).
- Per-machine panel: load %, status badge, jobs count, print button.
- 13-col table per machine: Order (↑↓ buttons) / # / JC No / Part+SO+Flow / Op / Operation / Priority / Due / Order / Done / Avail / Status / Action.
- Manual queue order persistence — **new schema column** `jc_ops.queue_position` (nullable int) OR a new `machine_queue_order` table. Decision: column on `jc_ops` for simplicity.
- Per-row "✚ Log Op" + "▶ Start" deep-links to `/op-entry`.

### Slice G — Production Schedule (Gantt)

Per `renderProductionSchedule` L15588 (largest legacy page in Production).

- `/production-schedule` — 30-day Gantt grid, one row per machine, drag-drop bars.
- Toolbar: Auto-Schedule + Reset + History + filter chips (All / Active / History / Future).
- Per-day cells with weekend tint + today highlight.
- Bar color: on-schedule / tight / at-risk / running / completed.
- Drag-drop reorders bars + opens detail modal on click.
- **Requires schema work:** `jc_ops.planned_start` + `planned_end` columns (or a new `jc_op_schedule` side table).
- **Auto-schedule + Reset + History** are big features — ship with simpler implementation initially (just renders the grid based on stored planned dates; auto-schedule pushed to follow-up).

### Slice H — Production Dashboard parity check (POLISH, deferred)

`/production-dashboard` exists but legacy points the sidebar slot at the global `renderDashboard`. Two options:
- **(A)** Make sidebar entry navigate to `/` (global dashboard) — matches legacy 1:1.
- **(B)** Keep `/production-dashboard` and extend it to match legacy's production-relevant blocks.

Recommendation: **A** — simpler, matches legacy verbatim. The current `/production-dashboard` page can be kept under a different label or repurposed.

For this session: leave `/production-dashboard` as-is, sidebar still points there. Open a backlog item to revisit.

---

## Schema additions

| Slice | Migration | New objects |
|---|---|---|
| F (Job Queue manual order) | `0034_phase8_jc_op_queue_position.sql` | `jc_ops.queue_position` (nullable int) |
| G (Production Schedule) | `0035_phase8_jc_op_schedule.sql` | `jc_ops.planned_start`, `jc_ops.planned_end` (nullable dates) |

---

## Cuts (DELTA — deferred for backlog)

- **Auto-Schedule / Reset & Re-schedule / History** buttons in the Gantt — depend on a scheduler algorithm + audit log.
- **Print buttons** (Daily Report, Job Queue, Shop Floor) — defer (CSV/Excel suffices for now).
- **Production Dashboard parity** with legacy global dashboard — flag in `docs/ISSUES.md`.

---

## Acceptance

Every legacy Production sidebar link in L453–470 navigates to a working React route that renders within ±5% of legacy chrome + data. Stock cascades that already flow through `op_log` writes continue to operate.

Tests deferred — user said "we will test once Production module built entirely" (carries over).

---

## Previous Production module status (replaced by the matrix above)

The earlier summary listed only 7 entries (Job Cards / Operators / Machines / Op Entry / Shop Floor reusing op-entry/machines / Machine Loading / Production Dashboard). This new matrix supersedes that. Earlier waves shipped:

- Wave 1: JC list 14-col parity (`5687534`) + Operator/Machine master parity (`d89feec`)
- Wave 2: Op Entry + Shop-Floor-like (`/op-entry/machines`) chrome refactor (`4deefaa`, `59e56bb`)
- Wave 3: Machine Loading page (`645db04`)
- Wave 4: Production Dashboard (`c7f554d`)
- Wave 5: JC create/edit modal — still pending (separate full-stack slice)

Cross-cutting backend gaps still open:
1. `machines.hour_rate`, `maint_cycle_days`, `last_maint_date` + `machine_maint_log` (for Machine Master polish)
2. JC write endpoints — create/update/delete with ops + docs
