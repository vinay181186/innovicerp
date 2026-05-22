# PARITY — GRN (Goods Receipt Note) (`renderGRN`)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L26444–26504. Helpers: `addGRN` L26515, `_grnSetMode`, `_grnLoadPOLines`, `_nextGRNNo` L26507.
> **React target:** `apps/web/src/modules/goods-receipt-notes/routes/list.tsx` (route `/goods-receipt-notes`). Existing implementation per `// Ports legacy renderGRN L26444` comment in file header.

---

## 0. Route + entry points

- ✅ Route `/goods-receipt-notes` exists.
- ⚠️ Sidebar label: legacy "GRN (Goods Receipt)" vs React "GRN". **POLISH** (label trim).
- ⚠️ Section header: legacy `📥 Goods Receipt Note (GRN)` vs React `Goods Receipt Notes`. **POLISH** (no emoji).

---

## 1. Toolbar (L26477–26482)

| # | Element | Legacy | React | Match? | Tag |
|---|---|---|---|---|---|
| 1 | Search input | "Search GRN, PO, vendor…" | "Search code, PO ref, DC, invoice…" | ✅ structure | **POLISH** placeholder |
| 2 | QC status filter | (via stat-card click) | `<select>` with GRN_QC_STATUSES | ⚠️ richer in React | **DELTA** (workable; stat-card filtering covered below) |
| 3 | + New GRN button | `addGRN()` modal | `/goods-receipt-notes/new` route | ✅ | — |

---

## 2. 4-tile stat strip (L26483–26488) — clickable filters

Legacy renders a 4-col stat grid above the table:

| # | tile | colour | value | click action |
|---|---|---|---|---|
| 1 | Total GRNs | cyan | `grns.length` | `_grnFlt='all'` |
| 2 | QC Pending | amber | `qcPendingGRNs.length` | `_grnFlt='qcpending'`; sub-text "→ Go to Incoming QC" |
| 3 | QC Cleared | green | `qcDoneGRNs.length` | (non-clickable) |
| 4 | Today | blue | `todayGRN.length` | `_grnFlt='today'` |

When filter is active, panel header shows `(<filter>)` in amber + "Show All" reset button.

- ❌ All 4 tiles missing in React (React has QC-status `<select>` filter instead). **BLOCKER** for parity — stat tiles at a glance are higher-value than a dropdown.

---

## 3. List table — columns (L26461–26473, headers L26493–26498)

Legacy: **11 cols** (`GRN No · Date · PO/JWPO · Vendor · Item Code · Received · QC Accepted · QC Rejected · QC Status · Ref · Action`).

| # | header | data | React match? | tag |
|---|---|---|---|---|
| 1 | GRN No. | cyan code | ✅ | — |
| 2 | Date | formatted | ✅ | — |
| 3 | PO/JWPO | blue mono | ✅ ("PO" col, but no JWPO distinction) | **POLISH** label |
| 4 | Vendor | name | ✅ | — |
| 5 | Item Code | purple (per-line view) | ❌ — React has grouped DC-header view, no per-item col on list | **DELTA** — legacy is flat per-receipt; React groups by GRN doc |
| 6 | Received | bold mono | ✅ "Received" col (totalReceivedQty) | ✅ |
| 7 | **QC Accepted** | green mono | ❌ missing | **BLOCKER** (per-GRN acceptance count — used by QC team) |
| 8 | **QC Rejected** | red mono | ❌ missing | **BLOCKER** |
| 9 | QC Status | badge | ⚠️ React shows "QC pending" count (richer in some ways) | **DELTA** — keep React |
| 10 | Ref (invoice/dc) | text3 | ✅ React shows DC col | ⚠️ partial — invoice missing |
| 11 | Assign action | 👤+ button for QC | ❌ | **DELTA** (Tasks module gate) |

Footer hint: `💡 GRN creates receipt record with QC Pending status…`
- ⚠️ React has a similar info banner. ✅

---

## 4. addGRN modal (L26515–26730+)

Large modal with **3-mode toggle** (legacy L26530–26536):

| mode | label | source |
|---|---|---|
| `po` | 📦 **Against PO** | Loads PO lines, fills receipt qty per line |
| `jwpo` | 🏭 **Against JWPO / DC** | Selects JWPO + DC to receive |
| `manual` | ✍ **Manual** | Free-form vendor + item + qty |

Common fields: GRN No (auto), Date, Invoice No, DC No, Remarks.

- React: separate `/goods-receipt-notes/new` route. **Verify mode toggle is present.** Legacy's 3-mode form is the entry-point distinction; without it the user can only do one of the modes.

---

## 5. Summary

### BLOCKERs (daily-use)
1. **4-tile stat strip** with click-to-filter (Total / QC Pending / QC Cleared / Today) — high visibility metric.
2. **QC Accepted + QC Rejected columns** in list — QC team scans these.

### DELTAs (workable today)
3. Per-line vs per-doc grouping — React's per-doc is cleaner; keep.
4. Assign-to-QC button — Tasks module gate.
5. Invoice number column — would round out the "Ref" col.

### POLISH
- Header `📥 Goods Receipt Note (GRN)` with emoji.
- Sidebar label "GRN (Goods Receipt)" (the longer legacy label).
- Search placeholder match.
- "PO/JWPO" header label.

---

**Sign-off needed before code:**
- Confirm 2 BLOCKERs above (tiles + QC counts) for next GRN slice.
- Verify the addGRN modal has all 3 modes (or document that the React equivalent does only PO mode).
