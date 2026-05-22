# PARITY — Sales Reports (`renderDeptReport('sales')`)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L20029–20045 (`renderDeptReport`). Sales-specific tabs from `_deptReportTabs.sales` L20013–20016. Tab bodies: `_rptItemWhere` L20447, `_rptSOLines` L20529. Generic table helper `_rptTbl` L20072+.
> **React target:** ❌ **WHOLE PAGE MISSING.** No `/reports/sales` or sales-dept routing on the existing `/reports` page.
> **Status:** ❌ entire feature absent; React has a generic `/reports` route but no sales-dept variant.

---

## 0. What this page is

A department-scoped reports page with 2 tabs:

| tab key | label | colour | body fn |
|---|---|---|---|
| `itemwhere` | **Item Tracker** | `#D97706` (orange) | `_rptItemWhere()` |
| `solines` | **SO Line Tracker** | `#7C3AED` (purple) | `_rptSOLines()` |

Department header: `📊 Sales Reports` in dept color `#16A34A` (green).

---

## 1. Page chrome (L20042–20044)

| # | Element | Legacy | Tag |
|---|---|---|---|
| 1 | Section header | `📊 Sales Reports` (green) | needs port |
| 2 | Tab buttons | 2 tabs, active highlighted | **BLOCKER** |
| 3 | Tab body | per-tab rendered via `_rptTbl(title, headers, rows, totals?)` helper | **BLOCKER** |

---

## 2. Tab content

### 2.1 Item Tracker (`_rptItemWhere` L20447+)

Cross-cutting report: for each item, where is it right now? (In stock, in production, at vendor, dispatched, etc.) Use `_rptTbl` helper to render.

**Tag:** **BLOCKER** — same report appears under Production dept too.

### 2.2 SO Line Tracker (`_rptSOLines` L20529+)

Per-SO-line view: order qty vs dispatched vs balance, status, due date, JC link.

**Tag:** **BLOCKER** — same shape as a denser version of `/so-overview` for compliance/audit.

---

## 3. Generic table helper `_rptTbl` (L20072–20118)

Reusable rendering helper used by every dept-report tab:

```js
_rptTbl(title, headers, rows, totals?)
```

Features:
- Auto-detects numeric columns (right-aligned + mono)
- Status-text colour coding (DELAYED/Pending/Cancelled → red; ON TIME/Accepted/Closed/OK → green; Approved/PARTIAL → blue; PENDING/AT VENDOR → amber)
- Zebra striping
- ⬇ Excel export button per panel (`_rptExcel(tableId, title)` — exports CSV with BOM L20120)
- Optional totals row at the bottom

---

## 4. Connection to the generic `/reports` page

Legacy `renderReports()` (L20047) renders **all 13 tabs across all departments** in a single tab strip. Per-dept (e.g. `renderDeptReport('sales')`) renders only that dept's 2 tabs.

React currently has `/reports` (a single page). Adding `/reports?dept=sales` (or a separate `/reports/sales` route) is the natural mapping.

---

## 5. Summary

### BLOCKERs
1. **Tab strip framework** for the existing `/reports` page (color-per-tab, active-highlight).
2. **`_rptTbl` equivalent React component** with status colour coding + numeric auto-detection + Excel export.
3. **Per-report endpoints** (one per tab body):
   - `GET /reports/item-tracker` — item-location rollup
   - `GET /reports/so-lines` — SO-line rollup
4. **Sales-dept route**: `/reports/sales` showing only the 2 tabs (or `/reports?dept=sales` query-state filter).

### DELTAs
- Generic `/reports` page (L20047–20070) already exists in React. Refactor it once and apply to all dept variants.

### POLISH
- Tab button colours match legacy palette exactly (`#D97706`, `#7C3AED`).
- IN-style `₹ N` formatting wherever currency appears.

---

**Sign-off needed:**
- Confirm whether sales-reports = a dedicated `/reports/sales` route, or a `?dept=sales` filter on the existing `/reports` page (recommend: filter).
- Confirm the 2 report types (item-tracker, so-lines) are scope for first pass.
- Estimate: ~400–500 LOC if shared with other depts (purchase, store, qc, production, finance, design).
