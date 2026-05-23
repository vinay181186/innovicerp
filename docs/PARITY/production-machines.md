# PARITY — Machine Master (`renderMachines`)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L13070–13160 (list `renderMachines`, `machineForm` L13113, `_logMaint` L13163).
> **React target:** `apps/web/src/modules/machines/routes/list.tsx` + `components/machine-form.tsx` (route `/machines`).

---

## 1. List columns (legacy 10 → React 7)

| # | Legacy header | data | React | Match? | Tag |
|---|---|---|---|---|---|
| 1 | Machine ID | td-code | ✅ cyan code → detail | ✅ | — |
| 2 | Name | bold | ✅ | ✅ | — |
| 3 | Type | text2 | ✅ | ✅ | — |
| 4 | Cap/Shift | mono "Nh" | ✅ | ✅ | — |
| 5 | **₹/hr** | green mono `hourRate` | (missing) | ❌ | DELTA — needs `machines.hour_rate` column |
| 6 | Status | `badge` | ✅ | ✅ | — |
| 7 | **Avail Qty** | amber bold `totalAvailQty` (calc-engine `machineLoad`) | (missing) | ❌ | **BLOCKER-backend** — needs machine-load aggregation (shared with Machine Loading page) |
| 8 | **Pending Hrs** | red bold `pendingHrs` (calc-engine) | (missing) | ❌ | **BLOCKER-backend** — same aggregation |
| 9 | **🔧 Maint** | colour-coded status from `lastMaintDate`+`maintCycleDays` | (missing) | ❌ | DELTA — needs maint columns |
| 10 | Actions | Edit · 🔧 _logMaint · Del | View · Edit | ⚠️ | DELTA (Maint log + Delete missing) |
| — | Shifts | (not in legacy list — form only) | EXTRA in React | ⚠️ | EXTRA — kept (harmless) |

## 2. Toolbar
- Title "Machine Master" ✅. Search "Search machine, type…" ✅. "+ Add Machine" ✅.
- React adds a status filter — EXTRA, kept.

## 3. Form (`machineForm` L13113)
| Field | Legacy | React (shared `machineSchema`) | Match? |
|---|---|---|---|
| Machine ID★ (readonly edit) | ✅ | ✅ `code` | ✅ |
| Machine Name★ | ✅ | ✅ `name` | ✅ |
| Type (full) | ✅ | ✅ `machineType` | ✅ |
| Capacity/Shift (hrs) | ✅ def 8 | ✅ `capacityPerShift` | ✅ |
| Shifts/Day (1/2/3) | ✅ | ✅ `shiftsPerDay` | ✅ |
| 💰 Hour Rate (₹/hr) | ✅ | ❌ | DELTA — no `hour_rate` field |
| Status (Running/Idle/Under Maintenance) | ✅ | ✅ (Idle/Running/Down/Maintenance) | ⚠️ POLISH (option labels differ) |
| MAINT SCHEDULE: Cycle (days) + Last Maint Date | ✅ | ❌ | DELTA — no maint fields |

## 4. Summary — backend-dependent, deferred from this pass

The remaining gaps all require **schema changes** (`machines.hour_rate`, `maint_cycle_days`, `last_maint_date`, and a `machine_maint_log` table) plus a **machine-load aggregation** (Avail Qty / Pending Hrs from `jc_ops` + `running_ops`).

- New migrations are **deferred** while uncommitted store-wave migrations (0030–0032) sit in the working tree (avoid ordering entanglement).
- **Avail Qty / Pending Hrs** aggregation is the same data the **Machine Loading** page (`renderLoading`) needs — build once there, reuse here. Tracked in `docs/PARITY/production-machine-loading.md`.

### Build order when unblocked
1. Migration: `machines` += `hour_rate numeric`, `maint_cycle_days int`, `last_maint_date date`; new `machine_maint_log` table (RLS, standard cols).
2. `v_machine_load` view (avail qty + pending hrs per machine) — reused by Machine Loading.
3. List cols 5/7/8/9 + form Hour Rate + Maint Schedule + 🔧Maint-log modal + Delete.
