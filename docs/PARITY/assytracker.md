# PARITY — Assembly Tracker (`renderAssemblyTracker`)

> ## ⚠️ THIS DOCUMENT HAS BEEN WRONG SIX TIMES. RE-VERIFY EVERY CLAIM AGAINST THE LEGACY FILE BEFORE ACTING ON IT.
>
> Audited 2026-07-16 (REFACTOR-1) against `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html`. **Every error leans the same way — asserting a parity that does not exist — which is exactly the direction that stops anyone looking.**
>
> | Claim | Verdict |
> | --- | --- |
> | ~~`.dash-stat-card` "✅ class exists in theme"~~ | ❌ **FALSE** — exists in **neither** the theme **nor** legacy. Corrected 2026-07-15. |
> | §5 item 3 — component table has *"Override (admin only)"*, **no `#` column** | ❌ **FALSE** — legacy **L28802 opens with `<th>#</th>`**. The column list is incomplete. |
> | §5 item 4 — units column order | ⚠️ legacy's order is stated correctly, but the doc **omits that our port had Remarks / Dispatch Status INVERTED** — presenting the port as matching when it did not. Fixed 2026-07-16. |
> | §5 item 1 — *"Progress bar … coloured teal/cyan"* | ❌ **MISLEADING** — the teal branch is **inert** (`--teal` is undefined in **both** systems). The bar is cyan or **invisible**, never teal. |
> | §1 / §8 — tiles *"`--teal` coloured for Done"* | ❌ **MISLEADING** — inert in legacy; legacy paints **no teal at all**. Its only real teal is a **literal `#14b8a6`** on the Done badge → `.b-teal`. |
> | §5 scope — *"Detailed mapping is OUT OF SCOPE … see a separate `assytracker-detail.md`"* | ⚠️ **That file was never written.** The detail was **unmapped** until 2026-07-16. |
>
> **Verified accurate:** §0 accordion split · §4.1 badge text/colours · §5's list of expanded-body sections.
>
> **⚠️ LEGACY BUG — DO NOT COPY:** legacy's progress bar switches its fill to `var(--teal)` at 100%. `--teal` is undefined → invalid declaration → **the bar renders EMPTY when complete**. Ours stays cyan deliberately.

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L28738–28887 (`function renderAssemblyTracker()`). Per-unit assemble logic at L28890+. `_atBuildAssemblies` builds the rollup (separate function — drives `data.assemblies` + `data.equipSOs`).
> **React target:** `apps/web/src/modules/assembly/routes/list.tsx` (route `/assemblies`, PL-5 shipped) = legacy's **collapsed card header L28782–28787** · `apps/web/src/modules/assembly/routes/detail.tsx` (route `/assemblies/$soId`) = legacy's **per-SO EXPANDED BODY L28788–28884** (mapped + refactored 2026-07-16).
> **Status legend:** ✅ match · ❌ differs · ⚠️ partial.
> **Tag every gap:** **BLOCKER** · **DELTA** · **POLISH**.

---

## 0. Route + entry points

- ✅ Route `/assemblies` exists (list); `/assemblies/$soId` exists (detail).
- ✅ Sidebar entry "Assembly Tracker" 🔧 under Planning (icon polish covered in `planning-sidebar.md`).
- ⚠️ Legacy is a **single-screen accordion** — list and detail share one route, each SO has a collapsed/expanded panel that toggles in place. React splits into list + detail routes. **DELTA** — React's split is OK for performance with many SOs, but loses the at-a-glance overview of multiple expanded SOs. Document choice and move on.

---

## 1. Header strip (L28746–28754)

Legacy: 5 status tiles in a `grid auto-fit minmax(145px)` row.

| # | Tile | Colour | Counts | React (list.tsx) | Match? | Tag |
|---|---|---|---|---|---|---|
| 1 | Total | blue | `assemblies.length` | ❌ missing | **POLISH** |
| 2 | Waiting | amber | `status==='waiting'` | ❌ missing | **POLISH** |
| 3 | Ready | green | `status==='ready'` | ❌ missing | **POLISH** |
| 4 | Assembling | cyan | `status==='assembling'` | ❌ missing | **POLISH** |
| 5 | Done | teal | `status==='done'` | ❌ missing | **POLISH** |

- ❌ **All 5 tiles missing in React list.** Click sets `atFilter` and re-renders. **BLOCKER** for parity but workable today since the list shows status badges per row.

Tile chrome: legacy writes `class="dash-stat-card"` (L28750) plus inline `bg2/border/14px/r10/center/pointer`.

> **CORRECTION 2026-07-15 (REFACTOR-1):** this line previously read *"✅ class exists in theme"*. **That was false.**
> `.dash-stat-card` is defined in **neither** `innovic-theme.css` (0 matches) **nor legacy's stylesheet** (0 matches) —
> legacy *uses* it at L24013-16 and L28750 and never defines it, so **it is inert in legacy too**. The tiles are
> styled entirely by legacy's inline attributes, which the port already mirrors. **Do not add a rule for it** —
> that would diverge from legacy, not match it. See ISSUE-027 for the method: "legacy references X" ≠ "legacy
> defines X" ≠ "X applies". A class can be spelled plausibly, typecheck, lint, and do nothing.

---

## 2. Toolbar (L28756–28762)

| element | legacy | React (list.tsx) | match? | tag |
|---|---|---|---|---|
| Search input | `🔍 Search SO, customer, item...` 240px min-width | ❌ missing | ❌ | **BLOCKER** — once list grows past a screen, search is essential |
| Status filter | `<select>` with All/Waiting/Ready/Assembling/Done | ❌ missing (status badges only) | ❌ | **BLOCKER** — needed to find pending work |
| Export Excel button | green `📄 Export Excel` → `_atExportExcel()` | ❌ missing | ❌ | **DELTA** (project-wide Excel gap) |

- React list.tsx shows a flat table with no toolbar. Section header is `🔧 Assembly Tracker`, no other affordances.

---

## 3. Empty state (L28772–28774)

Legacy: two-variant text — "No equipment assembly orders found. Create an Equipment SO with a linked BOM…" (when no equipSOs) vs "No results match your filter." (when filter zeroes out).

React: single empty state — `🔧 No Equipment SOs found. Create one on the Sales Orders page with type=equipment.` ✅ structurally fine; just the filtered-empty variant is missing (because filter is missing).

---

## 4. Per-SO panel — collapsed header (L28782–28787) — the row

Legacy panel structure: `bg2` card with a 1px coloured border (green/cyan/teal/border depending on status), 10px radius, click-anywhere-on-header toggles expand.

Header row layout (flex space-between):
- **Left block:**
  - SO No. — em-dash — BOM Name (14px bold)
  - ` × <orderQty> nos` (grey 12px after)
  - Below: `Customer: <name> | BOM: <bomNo> Rev <revision> | Due: <dueDate> | <statusBadge>` (12px)
- **Right block:**
  - Big assembled count `<assembledQty>/<equipQty>` (22px, coloured by status)
  - Small `assembled` label (10px grey)
  - Chevron `▶` / `▼` (14px grey)

| # | element | legacy | React list row | match? | tag |
|---|---|---|---|---|---|
| 1 | SO # | bold 14px, click-toggle | text `td-code` cyan, click → `/assemblies/$soId` | ⚠️ | **DELTA** — list/detail split |
| 2 | BOM name | bold 14px inline with SO# | separate column showing `bomNo` (no name) | ❌ | **POLISH** — show name too |
| 3 | × orderQty | grey suffix | not shown | ⚠️ | **POLISH** |
| 4 | Customer line | inline below header | separate column | ⚠️ | **DELTA** (workable) |
| 5 | BOM rev | `Rev <revision>` | not shown | ❌ | **POLISH** |
| 6 | Due date | inline | not shown | ❌ | **BLOCKER** — Due is the planner's "is this late?" signal |
| 7 | Status badge | pill, 4 colour variants with status-specific text — see below | `.badge` (4 colours, label-only) | ⚠️ | **POLISH** — badge text richer in legacy |
| 8 | Big count `M/N` | 22px, coloured by progress | shown as separate `Assembled` + `Required` columns | ⚠️ | **DELTA** — table is fine |

### 4.1 Status badge variants (L28778–28781)

| status | legacy text | colour | React label | match? |
|---|---|---|---|---|
| `'ready'` | `ALL READY ✓` | green | `Ready` | ❌ (POLISH — drop tickmark or add it) |
| `'assembling'` | `Assembling <assembledQty>/<equipQty>` | cyan | `Assembling` | ❌ (POLISH — counter in badge) |
| `'done'` | `Done ✓ <assembledQty>/<equipQty>` | teal | `Done` | ❌ (POLISH) |
| `'waiting'` | `Waiting — <readyCount>/<totalCount>` | amber | `Waiting` | ❌ (POLISH — component-readiness count in badge) |

React badge classes: `b-grey/b-blue/b-amber/b-green`. Legacy uses inline-styled spans with custom rgba backgrounds and exact colours — the React `.b-grey` for `waiting` is a clear mismatch (legacy is amber). **POLISH** colour fix.

---

## 5. Per-SO panel — expanded body (L28788–28884) — the detail screen

The expanded section is what `/assemblies/$soId` shows in React. Most of the per-SO content lives there. This section calls out what the LIST needs to show vs what's expanded-only in legacy:

**In legacy, expanded body contains:**

1. **Progress bar** (7px height, coloured teal/cyan) — `% = assembledQty/equipQty`. L28790.
2. **Summary stats panel** — `bg` card with 6–7 stats: ORDER QTY, CAN ASSEMBLE, ASSEMBLED, DISPATCHED, BALANCE, COMPONENTS (M/N ready), BOTTLENECK (when stock < req). L28791–28799.
3. **Component readiness table** — per BOM child row: Child Item (code+name) · Type (Mfg/Buy/JW) · Need · Auto Ready · Override (admin only) · Final Ready · Short · Enough For · Source · Status. L28801–28830.
4. **Assembled Units table** (when any built) — Unit # · Serial No · Assembly Date · Assembled By · Remarks · Dispatch Status (Dispatched/Pending) · Actions (Dispatch button per unit). L28832–28862.
5. **Action button bar** (bottom) — `🔧 Assemble 1 Unit (#N)` (teal, when stock supports more) · `✓ Mark All Done` · `📦 BOM Planning` · `📄 Export Shortfall` · `🚚 Dispatch Register` (nav) · `↩ Undo Last Unit` (admin only). L28865–28883.

→ **These all live in `apps/web/src/modules/assembly/routes/detail.tsx`. Detailed mapping is OUT OF SCOPE for the list page — see a separate `docs/PARITY/assytracker-detail.md` if needed.** Per goal scope, this doc maps the list view (which is the main `renderAssemblyTracker` body); detail is a follow-up. Flagging the existence of these sections so the reader knows where to look.

---

## 6. List columns shipped today (list.tsx L60–69)

Today's React list table:

| col | header | source | match to legacy? |
|---|---|---|---|
| 1 | SO # | `row.soId` → link | ✅ (legacy is the panel SO# anchor) |
| 2 | Customer | `row.customer` | ✅ |
| 3 | BOM | `row.bomNo` | ⚠️ (legacy shows BOM **name** in header, BOM **code** only in meta line) |
| 4 | Required | `row.equipQty` | ✅ (legacy: `<orderQty> nos` after SO name) |
| 5 | Assembled | `row.assembledQty` | ✅ (legacy: big right-side count) |
| 6 | Dispatched | `row.dispatchedQty` | ⚠️ legacy surfaces this only inside the expanded body |
| 7 | Status | `STATUS_BADGE[row.status]` | ⚠️ (POLISH — see §4.1) |
| — | **missing** | — | Due Date, BOM name + Rev, component-ready M/N |

Diffs vs legacy header:
- ❌ **Due Date column missing.** **BLOCKER** (§4 #6).
- ❌ **BOM name (not just code).** **POLISH**.
- ❌ **Component-ready counter M/N** (in status badge or as a column). **POLISH**.

---

## 7. Filter behaviour

Legacy: `<select>` with `all/waiting/ready/assembling/done` + text `<input>` for search. Filter set after both are applied (L28766–28770).

React: ❌ no filter, no search. **BLOCKER** (§2).

---

## 8. Summary — what counts as a BLOCKER for daily use

1. **Status filter + search toolbar** (§2) — assembling 50 Equipment SOs without filter = unworkable.
2. **5 status tiles** (§1) — at-a-glance counts AND click-to-filter shortcut.
3. **Due Date column** (§6) — planner needs to see overdue SOs immediately.

### DELTAs (workable today)
- List/detail screen split vs legacy single-screen accordion. React's split is fine; lose at-a-glance multi-SO view.
- Dispatched column on list — legacy hides it in expanded body; React surfaces it.
- Status badge text terseness — legacy is more descriptive; React is shorter.

### POLISH (deferred)
- Tile chrome (`.dash-stat-card`), tile colours per status.
- Status badge text (Ready ✓ / Assembling N/M / Done ✓ N/M / Waiting — N/M).
- Status badge colour for Waiting (amber, not grey).
- BOM name + Rev display.
- Excel export (project-wide gap).
- Component-ready counter on row.

---

## 9. What's NOT in scope here

- Per-SO detail view (`detail.tsx`) — covered in a follow-up `assytracker-detail.md` if required.
- `_atBuildAssemblies` data shape — covered in the API layer; not a UI parity issue.
- `_atAssemble1Unit` modal — detail-page concern.

---

**Sign-off needed before code:**
- Confirm the **3 BLOCKERs** above are PL-5b scope.
- Decide: keep list/detail split, or refactor to legacy's single-screen accordion?
- Approve adding `dueDate` to the list-API response shape (if not already there).
