# PARITY — Dispatch Register (`renderDispatchRegister`)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L10711–10787. `printDispatchRegister` at L10789–10821.
> **React target:** `apps/web/src/modules/delivery-challans/routes/list.tsx` (route `/delivery-challans`).
> **Status legend:** ✅ match · ❌ differs · ⚠️ partial.
> **Tag every gap:** **BLOCKER** · **DELTA** · **POLISH**.

---

## 0. Model mismatch — important context

Legacy `renderDispatchRegister` shows `db.dispatchLog` — a **flat log of dispatch events** generated when the user clicks 📦 Dispatch in Item Master. Each entry is a single qty deducted from stock with metadata (date, JC, SO, item, customer, dispatched-by).

React `/delivery-challans` shows **Delivery Challan documents** — a higher-level artifact with multiple line items, status, dates, addresses, etc. This is a richer formal model added in the migration (sidebar entry "Delivery Challans" introduced in earlier UI-003 work).

These are **different abstractions for the same business event**. Mapping today:

| concept | legacy | React |
|---|---|---|
| individual dispatch event | `dispatchLog` row | one DC line in `delivery_challan_lines` |
| document grouping | none — flat log | `delivery_challans` header |
| navigation target | "Dispatch Register" sidebar | "Delivery Challans" sidebar |

**Implication:** the legacy spec captures _what fields the log needs_; React captures _how DCs are organized_. The PARITY check is at the **column / KPI / action level**, not at the data model level.

---

## 1. Section header + toolbar (L10749–10755)

| # | Element | Legacy | React | Match? | Tag |
|---|---|---|---|---|---|
| 1 | Header label | `📦 Dispatch Register` | `Delivery Challans` (verify) | ❌ | **POLISH** (sidebar label rename per `sales-sidebar.md`) |
| 2 | Search input | `Search item, customer…` | ✅ React has search | ✅ | — |
| 3 | 🖨 **Print** button | `printDispatchRegister()` | ❌ missing | ❌ | **DELTA** (print template — separate ticket) |
| 4 | Status filter | (no status filter — log doesn't have status) | React: `<select>` with DC_STATUSES | ⚠️ EXTRA IN REACT | **DELTA** (workable; DC model has status, log doesn't) |
| 5 | + New DC button | (no — log is auto-populated from Item Master action) | ✅ React has +New | ⚠️ EXTRA IN REACT | **DELTA** (React DC needs explicit creation) |

---

## 2. KPI tile strip (L10756–10770) — **3 cards above the table**

| # | Tile | Legacy value | React | Match? | Tag |
|---|---|---|---|---|---|
| 1 | **Total Dispatched** (red, big number 28px) | Σ dispatchLog.qty | ❌ missing | ❌ | **BLOCKER** (operations watches this) |
| 2 | **Dispatch Entries** | logs.length | ❌ missing | ❌ | **BLOCKER** |
| 3 | **Items Dispatched** (cyan) | uniq itemCodes | ❌ missing | ❌ | **BLOCKER** |

No 3-tile strip in React today. **Adding this is the single most visible parity gap.**

---

## 3. Item-wise summary panel (L10771–10778)

Conditional panel — only shown when `Object.keys(summary).length > 0`.

Columns: `Item Code · Item Name · Total Dispatched · No. of Dispatches · Current Stock`.

- ❌ Entire panel missing in React. **DELTA** — operations finds it useful for end-of-day rollup; daily users can live without it.

---

## 4. Dispatch Log table (L10779–10785) — **the main content**

Legacy renders **12 columns**:

| # | header | data | React (DC list) | match? | tag |
|---|---|---|---|---|---|
| 1 | Date | `d.date` mono 11px | ✅ DC date column | ✅ structurally; ⚠️ DC date is **header** date not per-line dispatch date | **DELTA** |
| 2 | JC No. | `d.jcNo` cyan code | ❌ missing on list | ❌ | **DELTA** (visible in DC detail; not on list) |
| 3 | SO No. | `d.soNo` mono | ⚠️ verify React column | **DELTA** |
| 4 | **CPO Ln** | `d.clientPoLineNo` purple bold | ❌ missing | ❌ | **BLOCKER** (procurement traceability) |
| 5 | Item Code | `d.itemCode` purple | ❌ missing (DC list is per-DC not per-line) | ❌ | **DELTA** (drill into DC detail) |
| 6 | Item Name | from `db.items` | ❌ missing on list | ❌ | **DELTA** |
| 7 | **Qty** | `-d.qty` big red 15px | ❌ on DC list this is totals at the line level | ⚠️ | **DELTA** |
| 8 | UOM | item.uom tag | ❌ missing | ❌ | **POLISH** |
| 9 | Customer / Ref | `d.customer` | ✅ DC list has Customer | ✅ | — |
| 10 | Dispatched By | `d.dispatchedBy` text2 | ⚠️ verify | **POLISH** |
| 11 | Remarks | `d.remarks` text2 | ⚠️ verify | **POLISH** |
| 12 | **Stock B→A** | `${stockBefore}→${stockAfter}` text3 mono | ❌ missing | ❌ | **DELTA** (per-event stock trace — useful but legacy-only) |

---

## 5. Print template (L10789–10821)

Print template renders:
- Title block + print metadata
- 3-card info grid (Total Dispatched / Entries / Items Dispatched)
- 10-column table (Date · SO · CPO Ln · Item Code · Item Name · Qty · UOM · Customer · Dispatched By · Remarks)
- 3-signature row (Store In-Charge · Dispatch Manager · Authorised By)

❌ Entire print template missing in React. **DELTA** — Print is a project-wide gap.

---

## 6. Summary — BLOCKERs for daily use

1. **3-KPI tile strip** (§2) — Total Dispatched / Entries / Items Dispatched. Highly visible operational signal.
2. **CPO Ln column** (§4 #4) — procurement traceability (recurring theme across Sales & CRM screens).

### DELTAs (workable today)
3. Per-line dispatch view (drill-into-DC instead of flat log) — React's structure is richer; keep.
4. Item-wise summary panel — nice-to-have rollup.
5. Per-event Stock B→A column — would need per-line dispatch ledger.
6. Status filter (React extra) — keep.
7. + New DC button (React extra) — needed for the formal DC model.

### POLISH
- Header label "Delivery Challans" → "📦 Dispatch Register" (sidebar already covered in `sales-sidebar.md`).
- Print template (Dispatch Register PDF with signature block).
- UOM tags on rows.

---

## 7. Data model mapping (for whoever implements §2 KPI tiles)

The 3-tile KPI strip can be derived from the existing DC data:

- **Total Dispatched** = `SUM(dc_lines.dispatched_qty)` across all DC lines.
- **Dispatch Entries** = count of DC lines (or count of DCs if "entries" means documents).
- **Items Dispatched** = `COUNT(DISTINCT item_id)` across DC lines.

No new endpoint needed — the list endpoint can carry a `summary` object alongside `items`.

---

**Sign-off needed before code:**
- Confirm the 2 BLOCKERs above are scope for a `DR-1b` slice.
- Decide: rename sidebar entry "Delivery Challans" → "Dispatch Register" per legacy? (POLISH already flagged.)
- Approve adding a `summary: {totalDispatched, entryCount, itemCount}` field to the DC list endpoint response.
