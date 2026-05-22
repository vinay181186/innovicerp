# PARITY — Planning Dashboard (`renderPlanDashboard`)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L9994–10076 (`function renderPlanDashboard()`).
> **React target:** `apps/web/src/modules/plans/routes/dashboard.tsx` (route `/planning-dashboard`, PL-3 shipped).
> **Status legend:** ✅ match · ❌ differs · ⚠️ partial.
> **Tag every gap:** **BLOCKER** · **DELTA** · **POLISH**.

---

## 0. Route + entry points

- ✅ Route `/planning-dashboard` exists.
- ✅ Sidebar entry exists ("Plan Dashboard" 📊 under Planning section — see `planning-sidebar.md` for label polish).
- ⚠️ Section header today: `📊 Planning Dashboard`. Legacy has no header `<div>` — it wraps content in `<div style="padding:20px">` (L10075). The `_pageTitles.plandash='Planning Dashboard'` (L2219) is used by the topbar, not the body. **POLISH** (today's in-body header is OK).

---

## 1. KPI tile strip (L10013–10021)

Legacy renders 7 tiles in a flex-wrap row, each `.stat-card` with `border-color` set to the metric's colour. Tiles 1–6 are **clickable filters** (toggle `_planDashFlt` between `'all'` and the tile's filter key); tile 7 ("Total Plans") is non-interactive. The active filter tile shows `box-shadow: 0 0 0 2px <colour>`.

| # | Tile | Legacy filter key | Legacy colour | Counted set | React (KpiStrip) | Match? | Tag |
|---|---|---|---|---|---|---|---|
| 1 | **Needs Planning** | `'unplanned'` | red (`var(--red)`) | SO/JW open orders where `Σ planQty < orderQty` (L10004–10008) | tile present, value from `kpi.needsPlanning`, **colour `--amber2`** (not red) | ⚠️ | **POLISH** colour; ❌ **BLOCKER** click-to-filter |
| 2 | **In Planning** | `'inplanning'` | amber (`var(--amber)`) | `plans.status==='In Planning'` | tile present, colour `--text3` (grey) | ⚠️ | **POLISH** colour; ❌ **BLOCKER** click-to-filter |
| 3 | **Planned (Ready)** | `'planned'` | blue | `plans.status==='Planned'` | label is just `Planned` (no "(Ready)"); colour `--blue` | ⚠️ | **POLISH** label; ❌ **BLOCKER** click-to-filter |
| 4 | **JC Created** | `'jccreated'` | cyan | `plans.status==='JC Created'` | label match, colour `--cyan` | ✅ structure | ❌ **BLOCKER** click-to-filter |
| 5 | **PR Created (Buy)** | `'prcreated'` | purple `#8b5cf6` | `plans.status==='PR Created'` | label is just `PR Created`; colour `--cyan` (not purple) | ⚠️ | **POLISH** label + colour; ❌ **BLOCKER** click-to-filter |
| 6 | **In Prod / Done** | `'complete'` | green | `plans.status==='Complete'` **+** `plans.status==='In Production'` | React **splits this into 2 tiles**: "In Production" (`--amber2`) + "Complete" (`--green2`) | ❌ different structure | **DELTA** (React's split is arguably clearer; combining gives the click filter the right behaviour) |
| 7 | **Total Plans** | n/a — not clickable | default border | `plans.length` | not present in React | ❌ missing | **POLISH** (low value tile) |

**Per-tile chrome:**

| element | legacy | React | match? | tag |
|---|---|---|---|---|
| Container | `.stat-card` (legacy style) — bordered card with coloured top border, value in colour, grey label | inline-styled div: `border 1px solid var(--border)`, padding `8px 10px`, `bg2` background | ❌ visual | **POLISH** — wrap in `.stat-card` to match legacy |
| Value font | `.stat-val` (large, coloured by tile) | inline `fontSize:18` mono, coloured | ⚠️ smaller | **POLISH** |
| Label font | `.stat-label` (10px grey caps) | inline `fontSize:10 uppercase letter-spacing:0.05em` | ✅ | — |
| Active highlight | `box-shadow: 0 0 0 2px <colour>` on filter-matching tile | none | ❌ | follows from BLOCKER above |
| Hover cursor | `cursor:pointer` on filter tiles | none | ❌ | follows from BLOCKER above |

---

## 2. Filter behaviour (L10010–10011)

Legacy stores the active filter in `window._planDashFlt`. Default `'all'`. Filtered set:

| filter | result set |
|---|---|
| `'unplanned'` | (special — switches the body to the **"Needs Planning" table**, see §3) |
| `'inplanning'` | plans with status `'In Planning'` |
| `'planned'` | plans with status `'Planned'` |
| `'jccreated'` | plans with status `'JC Created'` |
| `'prcreated'` | plans with status `'PR Created'` |
| `'complete'` | plans with status `'Complete'` ∪ `'In Production'` |
| `'all'` | all plans (default) |

- ❌ **No filter state in React** — `RecentPlansTable` always renders `data.recentPlans` (capped server-side, no client toggle). **BLOCKER** — the tile-as-filter loop is the dashboard's primary affordance.
- ❌ **No `'unplanned'` mode** — the unplanned-orders table (see §3) is missing entirely. **BLOCKER**.

---

## 3. Body — "Needs Planning" table (L10024–10041) — when `flt==='unplanned'`

Section header: `⚠ Needs Planning (N SO lines)` (red).

Empty state: `✅ All SO lines are fully planned!`

Columns (10): `SO/JW · Line · Item · Part Name · SO Qty · Planned · Remaining · Due Date · Customer · Action`

- `SO/JW`: mono, bold, cyan (`o.soNo || o.jwNo || o._refNo`)
- `Line`: centered (`o.lineNo || '1'`)
- `Item`: purple bold (`o.itemCode || o.partNo`)
- `Part Name`: (`o.partName`)
- `SO Qty`: centered, bold (`n(o.orderQty)`)
- `Planned`: centered, cyan (`_pQ`, em-dash if 0)
- `Remaining`: centered, bold, red (`_rem`)
- `Due Date`: formatted
- `Customer`
- `Action`: cyan-bg button `📋 Plan N pcs` → `createPlan(o.id)` (jumps to /planning with this SO line pre-selected)

- ❌ **Entire "Needs Planning" mode missing in React.** **BLOCKER** — this is the dashboard's #1 actionable surface (planner sees what needs work and clicks Plan).

---

## 4. Body — Recent / filtered plans table (L10042–10073) — when `flt!=='unplanned'`

Pre-table affordance: `searchBox('planSearch','planTable','Search plans...')` (L10043) — a text input that filters table rows client-side via `id` match.

Empty state: `No plans in this category`

Columns (13): `Plan No. · Date · Type · SO/JW · Line · Item · Qty · Ops · Start · End · JC / PR · Status · Actions`

- `Plan No.`: mono, bold, cyan, clickable → `viewPlanDetail(p.id)`
- `Date`: 11px (`p.planDate`)
- `Type`: small coloured pill — `🛒 Buy` (green/`direct_purchase`), `🛠 Asm` (purple/`assembly`), `🏭 Mfg` (cyan/`manufacture`); legacy has **no `full_outsource` pill** here (treated as Mfg's else-branch) — confirm intent
- `SO/JW`: mono, 11px
- `Line`: centered
- `Item`: purple bold 11px
- `Qty`: bold + sub-text `/orderQty` in grey 9px
- `Ops`: count for non-DP; em-dash for `direct_purchase`
- `Start`: `p.plannedStartDate` formatted
- `End`: `p.plannedEndDate` formatted
- `JC / PR`: mono bold 11px — `p.jcNo` (cyan) when not DP, else `p.dpPRNo` (purple)
- `Status`: coloured text in `stColor` (amber/blue/cyan/purple/green by status)
- `Actions`: status-driven:
  - `'In Planning'` → ghost edit pencil → `editPlan`
  - `'Planned'` → green `⚡ Execute` button → `executePlan`
  - otherwise → ghost `View` → `viewPlanDetail`

### React (RecentPlansTable, dashboard.tsx)

Columns (10): `Plan # · Date · Type · Item · SO · Order Qty · Plan Qty · Ops · Status · Linked`

| # | column | legacy | React | match? | tag |
|---|---|---|---|---|---|
| 1 | Plan # | `Plan No.` cyan mono click→detail | `code` cyan mono, no click | ⚠️ | **POLISH** click handler |
| 2 | Date | yes | yes | ✅ | — |
| 3 | Type | small pill (Mfg/Buy/Asm) | text-only `icon label` (Mfg/Buy/Asm/Outsource) | ⚠️ | **POLISH** pill styling |
| 4 | SO/JW | mono code | text only `soCodeText` + ` · L#N` | ⚠️ | **POLISH** code styling |
| 5 | Line | yes | merged into SO column | ❌ | **DELTA** (workable) |
| 6 | Item | mono purple | text item code + name below | ⚠️ | **POLISH** styling |
| 7 | Qty | `planQty /orderQty` combo | **2 columns** (Order Qty + Plan Qty) | ❌ | **DELTA** (richer in React) |
| 8 | Ops | count | count | ✅ | — |
| 9 | Start | yes | ❌ **missing** | ❌ | **BLOCKER** — start/end dates are central to scheduling |
| 10 | End | yes | ❌ **missing** | ❌ | **BLOCKER** |
| 11 | JC / PR | mono ref | replaced by **Linked badges** column (JC linked / DP PR / FO PR / FO Mat PR) | ⚠️ | **DELTA** (React's Linked is richer, but loses the readable JC/PR code) |
| 12 | Status | coloured text | `.badge` (success colours match legacy intent) | ✅ | — |
| 13 | Actions | edit/execute/view by status | ❌ **none** | ❌ | **BLOCKER** — no edit/execute access from the dashboard; user has to navigate to /plans/$id |

**Missing affordances in React:**
- ❌ Per-row search box (L10043). **BLOCKER** — without filter + search, a long plan list is unusable.
- ❌ Action column. **BLOCKER**.
- ❌ Per-cell click-throughs (Plan # → detail). **POLISH** (Linked badges navigate elsewhere already).

---

## 5. Status badge palette (legacy `stColor` L10046, also L9365, L7137, L8866)

| status | legacy colour | React `STATUS_BADGE.cls` | match? |
|---|---|---|---|
| `In Planning` | amber | `b-grey` | ❌ (POLISH) |
| `Planned` | blue | `b-blue` | ✅ |
| `JC Created` | cyan | `b-cyan` | ✅ |
| `PR Created` | purple `#8b5cf6` | `b-cyan` | ❌ (POLISH) — purple class needed (`b-purple`?) |
| `In Production` | (n/a — same as JC Created) | `b-amber` | ❌ (POLISH) |
| `Complete` | green | `b-green` | ✅ |
| `Cancelled` | (not in dashboard — filtered out at L9996) | `b-grey` | ✅ |

---

## 6. Excel export

Legacy has no per-dashboard Excel export. ✅ neither does React. — no gap.

---

## 7. Summary — what counts as a BLOCKER for daily use

1. **Tile-as-filter click loop** (§1 #1–6, §2) — the dashboard's primary affordance is clicking a tile to drill into that status set. Today the tiles are read-only.
2. **"Needs Planning" mode + table** (§3) — the planner-facing "what should I do next" surface. Today missing entirely.
3. **Start / End date columns** in the plans table (§4 #9–10) — planning is about dates.
4. **Action column** with status-driven Edit / Execute / View buttons (§4 #13) — without this, planners can't act from the dashboard.
5. **Per-table search box** (§4 pre-table) — required once plans list grows past a screen.

### DELTAs (workable; review later)
- Tile structure: legacy combines In-Prod + Complete into one tile (§1 #6); React splits. Acceptable, but breaks tile-as-filter unless reconciled.
- "Linked badges" column (§4 #11) vs legacy "JC / PR" code column — React's is more informative for FO/FO-Mat cases; legacy's is more scannable.
- Order Qty / Plan Qty split (§4 #7) — workable.
- Total Plans tile (§1 #7) — low value.

### POLISH (deferred)
- Tile colours for In-Planning (amber not grey), Needs-Planning (red not amber), PR-Created (purple not cyan), In-Production (cyan not amber).
- Tile chrome: wrap each in `.stat-card`, use `.stat-val` / `.stat-label`.
- Status badge colour for In Planning (amber) and PR Created (purple).
- Plan # click-through to detail.
- Type pill styling (vs text + icon).
- Body padding to match legacy's `padding:20px` outer wrapper.
- Label "Planned (Ready)" / "PR Created (Buy)" to match legacy verbose labels.

---

**Sign-off needed before code:**
- Confirm the **5 BLOCKERs** above are scope for PL-3b.
- Decide: keep React's In-Production / Complete tile split (and lose tile-as-filter on one tile) OR combine to match legacy.
- Decide whether to keep Linked-badges column (React) or replace with JC/PR ref (legacy).
- Approve adding `GET /planning-dashboard/unplanned` endpoint for §3's "Needs Planning" SO-line list.
