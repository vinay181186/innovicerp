# PARITY — Production Dashboard (`renderDashboard`)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L3658+ (`renderDashboard`).
> **React target:** **none yet** — page missing. Suggested route `/production-dashboard` (legacy nav page `dashboard`, dept `production`). Distinct from `/` home (`renderHome`).

---

## Verdict: **MISSING — not built.** Needs calc-engine aggregation (`machineLoad` + `enrichedOps` + `jcStatus`).

Legacy `renderDashboard(calc)` is the production control board. Metrics derived from `calc`:
- Counters: `openJC`, `totalJC`, `runningOps`, `pendingComps` (Σ available non-outsource), `readyOps`/`readyQty`, `outsourceOps`, `atVendor`, `noOpsJC`.

### Page structure (to build)
1. **Stat tiles** — Open JC, Running ops, Pending qty, Ready (qty), Outsource, At vendor, No-ops.
2. **Per-machine pending queue panels** — for each machine, its pending ops sorted Priority→Due: JC No · Item · Operation · Status · Pending(avail) · Due (red if ≤3 days). "Idle / No pending work" when empty; "● Running" badge when a session is active.
3. **Open JC compact cards** — per open JC: code, priority badge, item × qty, **op-chain** (`.op-node` done/running/active, outsource 🏭), progress bar %, due date.
4. **"⚡ Ready to Process Now"** panel — enriched ops with available qty: JC · Op · Operation · Machine · Order · Completed · Available · Pending Hrs · Status.

### Build plan (full-stack)
1. **Backend**: a `production-dashboard` aggregation endpoint returning the counters + per-machine pending queues + open-JC ops chains + ready-to-process ops. Reuses `v_jc_op_status` (enriched ops), `v_jc_status` (jc status), and `v_machine_load` (machine grouping) once it exists.
2. **Shared schema** + API hook.
3. **Web module** `apps/web/src/modules/production-dashboard/` in legacy chrome (stat tiles, machine queue panels, JC cards w/ op-chain, ready table).
4. **Sidebar** + **router** wiring (Production → "Production Dashboard").

> Depends on the same calc-engine aggregation as Machine Loading — build `v_machine_load` first, then this. Deferred this pass (new migration held back vs. uncommitted store-wave migrations).
