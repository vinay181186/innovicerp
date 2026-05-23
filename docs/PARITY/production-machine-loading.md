# PARITY — Machine Loading (`renderLoading`)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L5021–5197 (`renderLoading`).
> **React target:** **none yet** — page missing. Sidebar omits it. Suggested route `/machine-loading` (legacy nav page `loading`, dept `production`).

---

## Verdict: **MISSING — not built.** Needs `machineLoad` backend aggregation.

Legacy `renderLoading(calc)` consumes `calc.machineLoad` + `calc.enrichedOps`. `machineLoad` is a per-machine roll-up computed by the legacy `calcEngine()`:

Per machine: `totalAvailQty`, `pendingHrs` (Σ available×cycleTime over its open ops), `dailyCap` (capPerShift×shifts), `daysToClear` (pendingHrs/dailyCap), `loadPct` (pendingHrs/dailyCap normalised), `loadStatus` (Clear/OK/Busy/Overloaded badge), and `ops[]` (its enriched ops).

### Page structure (to build)
1. **Header** `.section-hdr` "Machine Loading" + view toggle **Operation View / Job Queue View** + "All Machines ×" reset.
2. **Machine cards** (`.mach-cards` grid): per machine — id/name/type, Avail / Hrs / Days nums, load progress bar (green/amber/red by %), `loadStatus` badge, %; click → filter + Job Queue view.
3. **Operation View** (`.panel` table, 13 cols): `# · JC No · Part/Item · SO No · Op · Operation · Priority · Due · Order · Done · Avail★ · Pend Hrs · Status`, sorted Priority→Due.
4. **Job Queue View** (per-machine `.panel`): machine header (load bar, %, pending hrs, days, jobs count) + queue table with **op-chain flow** (`.op-node`/`.op-arrow`) + priority toggle (`togglePriority`).
5. **Capacity Summary** (`.panel` table, 10 cols): `Machine · Name · Type · Open Ops · Avail Qty · Pending Hrs · Daily Cap · Days to Clear · Loading% · Status`.

### Exact calc-engine formula (legacy `calcEngine()` L1668, L1703–1715) — port verbatim

Per op (L1668): `pendingHrs = available × cycleTime` (legacy cycleTime is HOURS).
**Our DB stores `jc_ops.cycle_time_min` (minutes)** → `pendingHrs = available × cycle_time_min / 60`.
`available` + `completed` come from `v_jc_op_status`.

Per machine (L1703–1715), over its ops (`jc_ops.machine_id = m.id`):
```
totalAvailQty = Σ available
pendingHrs    = Σ (available × cycle_time_min / 60)          -- 2 dp
dailyCap      = capacity_per_shift × shifts_per_day
weekCap       = dailyCap × 5
loadPct       = weekCap > 0 ? pendingHrs / weekCap : 0
daysToClear   = dailyCap > 0 ? round(pendingHrs / dailyCap, 1) : 0
loadStatus    = loadPct > 1   ? 'Overloaded'
              : loadPct > 0.7 ? 'High Load'
              : pendingHrs > 0 ? 'Manageable'
              : 'Clear'
```
Card % display = `min(150, round(loadPct × 100))`. Inputs verified to exist:
`jc_ops.machine_id` (uuid→machines.id), `jc_ops.cycle_time_min`,
`machines.capacity_per_shift`, `machines.shifts_per_day`, `v_jc_op_status.{available,completed_qty,computed_status}`.

> **No migration required** — compute in the service via raw SQL (like
> `job-cards`/`store-inventory` services), not a view.

### ⚠️ Build blocker (2026-05-23)
Wiring a new API module touches `apps/api/src/server.ts` (route registration)
and `packages/shared/src/index.ts` (schema export). **Both currently carry
uncommitted Store Wave 3/4 edits** (party-materials / party-grn / jw-dc), and
`index.ts` references untracked schema files. Cannot add Production exports
without entangling that work or breaking the build. **Resolve the store-wave
tree first** (commit or stash), then build Waves 3-5.

### Build plan (full-stack)
1. **Backend `v_machine_load` view** (or service aggregation): per machine — avail qty, pending hrs, daily cap, days to clear, load %, load status. Joins `machines` ⨝ `jc_ops`/`v_jc_op_status` (cycle time × available) ⨝ `running_ops`. RLS via base tables. Needs `machines.cycle`/`jc_ops.cycle_time` (cycle_time exists on jc_ops per v_jc_op_status usage).
2. **Shared schema** + `machine-loading` API hook.
3. **Web module** `apps/web/src/modules/machine-loading/` (route + cards + 2 views + capacity table) in legacy chrome.
4. **Sidebar** + **router** wiring (Production → Entry "Machine Loading").

**Reuse:** the `v_machine_load` aggregation also powers Machine Master cols 7-8 (Avail Qty / Pending Hrs) and the Shop-Floor machine-card load bar.

> Deferred this pass: new migration held back while uncommitted store-wave migrations (0030–0032) sit in the tree. This is the largest single Production build item.
