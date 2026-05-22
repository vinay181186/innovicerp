# PARITY — SO Overview (`renderSOOverview`)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L9112–9219 (+ `_deriveSOSummaries` L9064, `_soOvStageBadge` L9088, `_soOvStatusBadge` L9089).
> **Shipped status (2026-05-22):** PL-2b commit `68ee9dd feat(so-overview): PL-2b — in-screen drill view + status pills + Equipment column` shipped the named gap (in-screen drill) + status pills + Equipment column to `apps/web/src/modules/so-overview/routes/list.tsx` (933 lines). **The four §5 BLOCKERs below are now ✅ shipped.** Re-verify before treating any item as open work.
> **Shipped today (PL-2):** flat list at `/so-overview` — summary tile strip, search + status (open/closed) filter, one row per SO with code/customer/type/lines/status badge/progress/qty triplet/due/alerts + Activity-icon link to PL-1 SO Status. About **55% of legacy** is in.
> **Status legend:** ✅ present · ⚠️ partial · ❌ missing.
> **Tag every gap:** **BLOCKER** (team can't work without it) · **DELTA** (different but workable) · **POLISH** (visual only).

---

## 0. Route + entry points

- ✅ Route `/so-overview` exists; sidebar entry "📊 SO Overview" under Sales & CRM.
- ✅ Per-row Activity-icon link → `/sales-orders/$id/status` (PL-1).
- ⚠️ Per-row main click (legacy) → expands drill-down view in-screen (`_soOvShowSODetail` L9146). Today: per-row main click goes to `/sales-orders/$id` (SO Master). Either path takes the user *off* the overview screen. **THE NAMED GAP.**

---

## 1. List view (L9112–9143)

### 1.1 Header strip (L9138)

- ✅ Section header "📋 SO Overview".
- ✅ Search input (legacy: 280px wide; today: 220px).
- ❌ **⬇ Export All** button (green) — legacy `_soOvExportAll()` generates a 2-sheet xlsx (summary + all-lines detail). **DELTA** (project-wide Excel gap; document separately).

### 1.2 Summary tile strip (L9139)

Today: 7 tiles (Total / Not Started / In Progress / On Track / Delayed / Completed / Blocked). **✅ structure present** (more granular than legacy's 4).

Legacy: 4 tiles (TOTAL SOs / COMPLETED / DELAYED / IN PROGRESS). Today's 7-tile strip is **strictly richer**; no parity work needed. ✅ (today is better than legacy).

### 1.3 Status filter chip-pill row (L9118–9119, 9140)

Legacy renders one-click filter pills above the table for each non-empty status (Not Started / In Progress / On Track / Delayed / Completed / Blocked) with active highlight + count. Click toggles between "all" and the chosen status.

- ❌ Replace today's `<select>` dropdown with a row of pill buttons. **BLOCKER** (the dropdown works but is one extra click vs. legacy's one-click pill — the chip-pill row is a key planner UX).
- ❌ Make the existing summary tiles also clickable as a filter shortcut. **DELTA** (the pill row is the primary filter; tiles-as-filter is duplicative).

### 1.4 List table columns (L9141)

Legacy columns: `SO No · Customer · Type · Equipment · Items · Status · Progress · Required · Done · Balance · Due Date · Alerts · SO Date` (13 cols).

Today's columns: `SO # · Customer · Type · Lines · Status · Progress · Required · Done · Balance · Due · Alerts · (Action icon)` (12 cols).

Diffs:

- ❌ **Equipment** column missing — legacy shows `s.equipName` (purple, 12px) for Equipment SOs. Today doesn't surface the equipment item code at all on this row. **BLOCKER** (Equipment SOs are a major use case and "which equipment is this SO for" is a basic identifier).
- ⚠️ **Items** (legacy) vs. **Lines** (today): legacy `s.totalItems` counts BOM children when Equipment, line count when Component. Today's `lineCount` just counts SO lines. **DELTA** (legacy's count is more useful for Equipment SOs but today's is technically correct).
- ❌ **SO Date** column missing — legacy shows in muted text far right. **POLISH** (low-value column; click-through has the same data).
- ✅ Required / Done / Balance — present.
- ✅ Due Date with red-when-overdue colour.
- ⚠️ **Alerts column** — today: badges (b-red/b-blue/b-amber/b-red). Legacy: inline icons (`⚠N` / `🏭N` / `🔬N` / `🚫N`) with em-dash when none. **POLISH** (same data, different visual weight).

### 1.5 Row click behaviour (L9123)

- ❌ **In-screen drill-down** — legacy: clicking a row stashes detail HTML in `window._soOvDetailHtml` and re-renders the *same* route with the detail view (replacing the list). A "← Back to SO Overview" button at the top of the detail clears the stash. **BLOCKER** (this is the named gap from 2026-05-21 — the planner clicks an SO to see its items + stages without leaving the overview).
- ⚠️ Today: per-row main click → `/sales-orders/$id`; Activity icon → `/sales-orders/$id/status`. Both routes exist and serve their purpose, but **neither replaces the overview screen** — the user loses the filter + summary context. **DELTA → BLOCKER** for parity.

### 1.6 Helper text (L9142)

- ❌ Footer hint: `💡 Click any SO row to see BOM item breakdown / SO line detail with Stage & Status per item.` **POLISH** (once drill is in, this hint is obvious).

---

## 2. Drill-down view (`_soOvShowSODetail`, L9146–9219) — THE NAMED GAP

When a row is clicked, the list is replaced (same screen, not a new route) with:

### 2.1 Drill header (L9150–9157)

A rounded-bg-3 card with 6–7 columns (depending on Equipment vs. Component):

- ❌ **SO NUMBER** label + big cyan SO# (18 px). **BLOCKER**
- ❌ **CUSTOMER** label + customer name (14 px) + optional `PO: <clientPoNo>` below (11 px). **BLOCKER**
- ❌ **TYPE** label + `⚙ Equipment` or `📋 Component`. **BLOCKER**
- ❌ **EQUIPMENT** label + equipment name (purple) + `× <equipQty>` — only when Equipment. **BLOCKER**
- ❌ **BOM** label + BOM number (green) — only when Equipment with BOM. **BLOCKER**
- ❌ **DUE DATE** label + date (red when overdue + not Completed). **BLOCKER**
- ❌ **STATUS** label + status badge. **BLOCKER**

### 2.2 Overall progress block (L9159–9162)

- ❌ "Overall Progress" label + % (right-aligned, color-coded by status: green if Completed, red if Delayed, else cyan). **BLOCKER**
- ❌ 10px progress bar. **BLOCKER**
- ❌ Inline stats: `Required: N · Completed: N (green) · Balance: N (red if > 0, green if 0) · Items: N (purple)` + optional `⚠ N delayed` (red). **BLOCKER**

### 2.3 Stage + Status chip strips (L9164–9173)

Two rows in a single `bg-4` panel:

- ❌ **STAGE:** label + per-stage badge (Not Released / In Production / Outsourced / Quality Check / Finished / Hold-Blocked) + count for each non-zero stage. **BLOCKER**
- ❌ **STATUS:** label + per-status badge (Not Started / In Progress / On Track / Delayed / Completed / Blocked) + count for each non-zero status. **BLOCKER**
- These are read-only — pure visual rollup; not clickable as filters in legacy.

### 2.4 Per-item table (L9184–9213) — **the big one**

Title: `📦 BOM Items — <bomNo>` (Equipment) OR `📋 SO Line Items` (Component), with `(<totalItems>)` count + green ⬇ Export Excel button.

Columns (15 for Equipment, 17 for Component):

- ❌ **Equipment:** `Item Code · Item Name · Stage · Status · Required · Issued · In Prod · QC Pend · At Vendor · Done · Balance · Current Op · Machine / Vendor`. **BLOCKER**
- ❌ **Component:** prepends `Ln · CPO Ln` to the above. **BLOCKER**
- ❌ **Per-column filter row** (header second row): item-code/name text inputs, Stage dropdown, Status dropdown, current-op text input, machine/vendor text input. Filters applied client-side via `_soOvColFilter()` L9091–9110. **DELTA** (table is short enough that scrolling works; column-filters are a nice-to-have).
- ❌ Per-row tinting: red if Status=Delayed, green if Status=Completed, else zebra. **POLISH**
- ❌ Current Op (cyan, 11 px) — the operation currently running OR the next-up op. **BLOCKER** (this is the procurement/floor visibility piece).
- ❌ Machine / Vendor column: shows `🏭 <vendor>` (purple) when atVendor > 0 OR stage=Outsourced; `🔬 QC` (green) when location=QC; `⚙ <machine>` (cyan) when in production; em-dash otherwise. **BLOCKER**

### 2.5 Back button (L9217)

- ❌ "← Back to SO Overview" ghost button at top-left of the drill view. **BLOCKER** (clears the drill, returns to list).

### 2.6 Per-SO Excel export (L9183, 9221–9235)

- ❌ Per-SO ⬇ Export Excel button — exports the items table as a single-sheet xlsx. **DELTA** (project-wide Excel gap).

---

## 3. Data model — what the drill needs

Legacy `_deriveSOSummaries` (L9064) computes for each SO:

- header fields (already in `SoOverviewRow`): id, code, customer, type, dueDate, status, etc.
- **`childRows`** — the per-item array. For Equipment SOs: one row per BOM child item; for Component SOs: one row per SO line. Each child row has:
  - `itemCode`, `itemName`, `requiredQty`, `issuedQty`, `inProductionQty`, `qcPendingQty`, `atVendorQty`, `completedQty`, `balanceQty`
  - `stage` (Not Released / In Production / Outsourced / Quality Check / Finished / Hold-Blocked)
  - `status` (Not Started / In Progress / On Track / Delayed / Completed / Blocked) — same enum as overall status
  - `currentOpName`, `machineName`, `vendorName`, `currentLocation` (Factory / Vendor / QC)
  - For Component SOs: `lineNo`, `clientPoLineNo`
- summary aggregates already on SO row: stageCounts, alerts, totals

**Wire-shape addition for PL-2b:** a per-SO detail endpoint that returns the `childRows[]` array plus the header fields. Pattern matches PL-4b's `GET /so-planning/:soId/bom/:lineId` and PL-1's `GET /so-status/:soId`.

---

## 4. API contract — what changes

**Option A (recommended):** New endpoint `GET /so-overview/:soId/detail` returning:
```ts
{
  generatedAt: string;
  so: SoOverviewRow;            // reuse existing shape — already has summary aggregates
  childRows: SoOverviewChildRow[];  // new shape — see §3
  isEquipmentDrill: boolean;    // true → childRows are BOM children; false → SO lines
  bomNo: string | null;
}
```

**Option B (rejected):** extend `GET /so-overview` to inline `childRows` on every row. Rejected because lists of 50+ SOs would each carry their BOM children — kills the list query and most rows never get expanded.

**Migration:** none. All data already in DB. Math reuses the calc-engine + per-line stage derivation from PL-1.

---

## 5. Summary — what counts as a **BLOCKER** for daily use

Ranked for this slice (PL-2b):

1. **In-screen drill view** (§2 entire) — header + progress block + stage/status chips + per-item table with Stage / Status / qty triplets / current op / machine-vendor. Back button to return to list. **The named gap.**
2. **Per-row click handler swap** — main click opens drill instead of `/sales-orders/$id`. Activity icon stays as the explicit "go to SO Status" shortcut. (§1.5)
3. **Status filter chip-pill row** above the table (§1.3) — replaces the dropdown with one-click pills.
4. **Equipment column** in the list table (§1.4) — shows equipment name for Equipment SOs.

The new endpoint (§4 Option A) plus the front-end drill component land together.

DELTAs deferred to backlog:
- ⬇ Export All (§1.1) + per-SO ⬇ Export Excel (§2.6) — project-wide Excel gap.
- Per-column filter row in drill table (§2.4) — nice-to-have when row counts grow.
- Items-vs-Lines column semantics (§1.4) — today's "Lines" count is technically correct.

POLISH deferred:
- SO Date column (§1.4), Alerts column visual weight (§1.4), Footer helper text (§1.6), drill row tinting (§2.4), make summary tiles clickable as filters (§1.3).

---

## 6. What's NOT in scope

- Drill-down editing actions (create JC / create PO from drill rows). Stays in PL-4b (`/planning`) + PL-1b (`/sales-orders/$id/status`).
- Multi-SO bulk Excel export. Defer to project-wide Excel ticket.
- Inline column filters in the drill table. Defer to backlog (DELTA).

---

**Sign-off needed before code:**
- Confirm the **4 BLOCKERs** in §5 are the right scope.
- Approve **Option A endpoint** in §4 (new `GET /so-overview/:soId/detail`, no schema changes).
- Tell me if you want any of the DELTAs (Export, column filters, Items-vs-Lines) promoted to BLOCKER.
