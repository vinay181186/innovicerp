# PARITY — Sales & CRM sidebar block (#sidebar > .sb-mod-sales)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L407–424. Dept color at L24/L65 (`--dept-sales:#16a34a`). Page-title map L2219–2221, icon map L2257, render map L2416–2473.
> **React target:** `apps/web/src/components/shared/sidebar.tsx` L71–90 (SECTIONS[1] `key:'sales'`).
> **Status legend:** ✅ match · ❌ differs · ⚠️ partial.
> **Tag every gap:** **BLOCKER** · **DELTA** · **POLISH**.

---

## Comparison matrix

### Section header (L407)

| # | Element | Legacy (L407) | React | Match? | Tag |
|---|---|---|---|---|---|
| 1 | Section key | `'sales'` | `key: 'sales'` | ✅ | — |
| 2 | Section label | `Sales & CRM` | `Sales & CRM` | ✅ | — |
| 3 | Section icon | 💰 (`&#128176;`) | 💰 | ✅ | — |
| 4 | Mod class | `sb-mod-sales` | `modClass: 'sales'` | ✅ | — |

### Group + items (L409–423)

| # | Group | Pos | Legacy item (line) | React item | Match? | Tag |
|---|---|---|---|---|---|---|
| 1 | Entry | 1 | `somaster` · 📋 **"SO Master"** (L410) | `/sales-orders` · 📋 **"SO Master"** | ✅ | — |
| 2 | Entry | 2 | `jwmaster` · 🔧 **"JW Master"** (L411) | `/job-work-orders` · 🔧 **"JW Master"** | ✅ | — |
| 3 | Entry | 3 | `dispatch` · 📦 **"Dispatch Register"** (L412) | `/delivery-challans` · 📦 **"Delivery Challans"** | ❌ label paraphrased | **POLISH** (legacy says "Dispatch Register") |
| 4 | CRM | 1 | `crmleads` · 🔥 **"Leads & Pipeline"** (L414) | *(missing — no /leads route)* | ❌ MISSING | **BLOCKER** (whole CRM page absent) |
| 5 | CRM | 2 | `crmreminders` · ⏰ **"CRM Reminders"** (L415) | *(missing)* | ❌ MISSING | **BLOCKER** |
| 6 | CRM | 3 | `crmcustomer360` · 👤 **"Customer 360°"** (L416) | *(missing)* | ❌ MISSING | **BLOCKER** |
| 7 | Master | 1 | `clients` · 🏢 **"Client Master"** (L418) | `/clients` · 🏢 **"Client Master"** | ✅ | — |
| 8 | Report | 1 | `sotimeline` · 📅 **"SO Timeline"** (L420) | *(missing)* | ❌ MISSING | **DELTA** (Gantt-style report — useful but defer) |
| 9 | Report | 2 | `sodocs` · 📁 **"SO Documents"** (L421) | *(missing)* | ❌ MISSING | **DELTA** |
| 10 | Report | 3 | `pendingsovalue` · 💰 **"Pending SO Value"** (L422) | *(missing)* | ❌ MISSING | **BLOCKER** (revenue/cashflow signal — high value) |
| 11 | Report | 4 | `rpt_sales` · 📊 **"Sales Reports"** (L423) | `/reports` is generic; no sales-dept variant | ❌ MISSING | **DELTA** (generic /reports likely covers most) |
| — | n/a | — | *(legacy CRM group missing entirely from React)* | — | — | — |
| — | n/a | — | *(legacy Report group missing entirely from React)* | — | — | — |

### Sidebar group labels (L409, L413, L417, L419)

Legacy uses 4 groups: **Entry · CRM · Master · Report**. React has 2: **Entry · Master**. 2 groups (CRM, Report) need to be added once their pages ship.

---

## Page-title map (L2219–2221)

Legacy `_pageTitles` for Sales & CRM pages:

| page | title |
|---|---|
| `somaster` | `SO / WO Master` |
| `jwmaster` | `JW Master (Job Work)` |
| `dispatch` | `Dispatch Register` |
| `clients` | `Client Master` |
| `crmleads`, `crmreminders`, `crmcustomer360`, `sotimeline`, `sodocs`, `pendingsovalue`, `rpt_sales` | (in `_pageTitles` map further down — capture when per-page doc is written) |

---

## Summary

Total elements: 11 items + 4 groups
Matching outright: 3 (SO Master, JW Master, Client Master)
Differing on label: 1 (Dispatch Register → "Delivery Challans")
Missing in React: 7 whole pages

### BLOCKERs
1. ~~**CRM Leads & Pipeline**~~ — DEFERRED 2026-05-23 (not critical now)
2. ~~**CRM Reminders**~~ — DEFERRED 2026-05-23 (paired with #1)
3. ~~**Customer 360°**~~ — DEFERRED 2026-05-23 (paired with #1)
4. ~~**Pending SO Value**~~ — SHIPPED 2026-05-23 (commit `4652aaa`)

### DELTAs (defer; team can work without them)
5. **SO Timeline** — Gantt-style report
6. **SO Documents** — document index
7. **Sales Reports** (`rpt_sales`) — generic department-report instance

### POLISH (deferred)
8. Rename "Delivery Challans" → "Dispatch Register" in the sidebar to match legacy L412.

---

**Sign-off needed before code:**
- Confirm the 4 CRM/Report BLOCKERs are the right scope for a future "PCRM-1" slice.
- Confirm whether "Dispatch Register" rename is desired (POLISH) — the route file name (`delivery-challans`) is fine; only the label changes.
- Decide whether Sales Reports gets its own route or routes via `/reports?dept=sales`.
