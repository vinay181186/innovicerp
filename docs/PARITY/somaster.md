# PARITY — SO / WO Master (`renderSOmaster`)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L11839–11975 (`function renderSOmaster()`). Helpers: `addSO`, `_editFullSO`, `editSOLine`, `delSO`, `soImportExcel`, `soImportTemplate`, `showEquipBOMPlanning`.
> **React target:** `apps/web/src/modules/sales-orders/routes/list.tsx` (route `/sales-orders`).
> **Status legend:** ✅ match · ❌ differs · ⚠️ partial.
> **Tag every gap:** **BLOCKER** · **DELTA** · **POLISH**.

---

## 0. Route + entry points

- ✅ Route `/sales-orders` exists.
- ✅ Sidebar entry "📋 SO Master" under Sales & CRM → Entry.
- ⚠️ Section header: legacy = `SO / WO Master` (L11962). React = `Sales Orders`. **POLISH** (label).

---

## 1. Toolbar (L11963–11968)

| # | Element | Legacy | React | Match? | Tag |
|---|---|---|---|---|---|
| 1 | Search input | "Search SO, client, item..." 220px | "Search code, customer, client PO…" 240px | ✅ structure | **POLISH** placeholder text |
| 2 | ⬇ Excel **Template** button | yes — `soImportTemplate()` | ❌ missing | ❌ | **DELTA** (Excel gap project-wide) |
| 3 | 📄 **Import Excel** button | yes — `soImportExcel()` | ❌ missing | ❌ | **DELTA** (Excel gap project-wide) |
| 4 | **+ New SO / WO** primary | yes — `addSO()` | `+ New SO` → `/sales-orders/new` | ✅ | — |
| 5 | Status filter | (not in toolbar) | `<select>` with all SO_STATUSES | ⚠️ EXTRA IN REACT | **DELTA** (React's filter is a useful add; legacy doesn't have one) |
| 6 | Type filter | (not in toolbar) | `<select>` with all SO_TYPES | ⚠️ EXTRA IN REACT | **DELTA** |

---

## 2. List table — header row columns (L11857–11877)

Legacy renders **12 columns**:

| # | header | data | match? | tag |
|---|---|---|---|---|
| 1 | (expand chevron) + SO No | cyan mono 13px bold | ✅ SO No present, but no expand chevron | ❌ chevron | **BLOCKER** (row expand is core nav — see §3) |
| 2 | Lines count | `N lines` cyan 11px | ✅ "Lines" col present | ✅ | — |
| 3 | Date | `first.soDate` formatted | ✅ "Date" col | ✅ | — |
| 4 | Customer | `clientCode — customer` OR `customer` | ⚠️ shows `customerName` only; no client-code prefix | ❌ | **DELTA** (workable; legacy's prefix is nicer for repeat customers) |
| 5 | Client PO | `clientPoNo` purple mono + 📎 file link if `clientPoFileUrl` | ❌ missing | ❌ | **BLOCKER** (PO traceability — purchasing/QC need it on the list view) |
| 6 | Total Qty | sum across lines, bold | ✅ "Total Qty" col | ✅ | — |
| 7 | JC Qty | `jcQty/orderQty` with green/amber/grey colour | ✅ "JC Qty" col with same colour logic | ✅ | — |
| 8 | Due Date | `first.dueDate` formatted | ❌ missing | ❌ | **BLOCKER** (planners scan due dates on the list) |
| 9 | Type | `badge(first.type)` | ✅ "Type" col (no badge — text) | ⚠️ | **POLISH** (use badge styling) |
| 10 | Status | `b-green` (Closed) / `b-blue` (Open) + **BOM-status secondary badge** for Equipment SOs (BOM Pending / Assigned / Planned) | ✅ status only; ❌ BOM-status secondary badge missing | ⚠️ | **BLOCKER** (BOM status visibility on Equipment SOs — planners drive BOM creation from here) |
| 11 | Remarks | `first.remarks` ellipsis 80px | ❌ missing | ❌ | **POLISH** |
| 12 | Actions | **+ Line** button (`addSO(soNo)`) + 👤+ Assign button (manager/admin, non-Closed only) | ❌ missing | ❌ | **DELTA** + Line action; **DELTA** Assign action |

React table = 8 columns. **5 legacy columns missing.**

---

## 3. Row click — expand mode (L11878–11958) — **the big gap**

Clicking an SO row toggles `_soExpanded[soNo]`; the chevron flips ▶/▼, and the row's background tints green when expanded. The expanded body is rendered as a `<tr>` with `colspan=12` containing one of two layouts:

### 3.1 Equipment SO expansion (L11881–11927)

A 6-column **details strip** (EQUIPMENT · EQUIP QTY · DUE · BOM STATUS · LINKED BOM · actions block):
- ❌ Inline ✏ Edit button → `editSOLine(eqLine.id)`. **BLOCKER**
- ❌ 📦 Plan BOM Items button (cyan) → `showEquipBOMPlanning(eqLine.id)` — when BOM is linked. **BLOCKER**
- ❌ Del button (admin/manager). **BLOCKER**

Below the strip, a **BOM Items table** (8 columns: # · Item Code · Item Name · Qty/Set · Total Need · Type · Stock · Shortfall) when a BOM is linked.
- ❌ Per-row tinting: red if shortfall>0, green if shortfall=0. **POLISH**

When no BOM linked: amber notice "⚠ No BOM linked. Edit this SO to assign a BOM…" — **POLISH**.

### 3.2 Component SO expansion (L11929–11956)

A **Line Items table** (11 columns: Ln · CPO Ln · Item Code · Part Name · Qty · JC Qty · Dispatched · Balance · Due Date · Status · Actions).
- ❌ Per-line Edit + Del buttons (admin/manager). **BLOCKER**
- ❌ Dispatched and Balance columns. **BLOCKER**
- ❌ CPO Ln (client PO line) purple bold. **BLOCKER** (procurement asks for this)

### 3.3 React equivalent

- ⚠️ Today: clicking the SO# Link navigates to `/sales-orders/$id` (a separate detail page). This loses the in-screen drill that legacy gives. **DELTA → BLOCKER** for parity.
- The drill data (lines, equipment-BOM strip, per-line dispatched/balance) is already produced server-side for the so-overview drill (PL-2b §2.4) — likely reusable for SO Master row expansion.

---

## 4. Header click — full SO edit (L11858)

- ❌ Clicking the SO header row in legacy fires `_editFullSO(soNo)` — opens a wizard-style edit modal that lets the user edit the SO header + all lines at once. **DELTA → BLOCKER**.
- React today: SO# link → `/sales-orders/$id`. There's no "edit full SO" wizard — only per-route edit at `/sales-orders/$id/edit`. **BLOCKER** if the wizard is the day-to-day flow; **DELTA** if separate edit pages are OK.

---

## 5. Per-row Assign button (L11875)

- ❌ 👤+ Assign-to-user button — opens `_assignTaskFromContext` with the SO id + a pre-filled message (`Create BOM for X` for BOM-pending Equipment SOs; `Follow up X` otherwise). **DELTA** (Tasks module not yet built).

---

## 6. Summary — BLOCKERs for daily use

1. **Row expand to show line items / Equipment BOM** (§3) — without it, the SO Master loses 70% of its workflow value (planners need to see lines + BOM + balance from this screen).
2. **Client PO column** (§2 #5) — purchasing/QC traceability.
3. **Due Date column** (§2 #8) — planner's "what's late" signal.
4. **BOM-status secondary badge** on Equipment SOs (§2 #10).
5. **Plan BOM Items action** inside the expand body (§3.1) — currently only reachable from Planning workflow.
6. **+ Line action** in row Actions (§2 #12 + §4 wizard) — adding lines to an existing SO without going through full edit.

### DELTAs (workable today)
- Status + Type filters (React extra) — keep, they're useful.
- Excel template + import (legacy extras) — project-wide Excel gap.
- Header label "Sales Orders" vs "SO / WO Master" — POLISH.
- Per-row Assign button — Tasks module not yet built.

### POLISH
- Customer column "clientCode — customer" prefix.
- Type column → badge styling.
- Remarks ellipsis column.
- Placeholder text wording.

---

**Sign-off needed before code:**
- Confirm the **6 BLOCKERs** above are scope for `SOM-1b` slice.
- Decide: in-screen row expand (legacy) vs separate detail page (React today). Recommend in-screen expand — matches PL-2b drill pattern and SO Planning two-pane workflow.
- Decide: should the "edit full SO wizard" replace per-route edit, or live alongside?
