# PARITY — Stock Ledger (`renderStockLedger`)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L25013–25143. Aggregates 6 source tables into a unified movement log. Helper `_slExport` for Excel.
> **React target:** `apps/web/src/modules/store-transactions/routes/list.tsx` (route `/store-transactions`). Already shipped — needs parity audit on the multi-source aggregation.

---

## 0. What this page is

The **unified per-movement ledger** — every stock-changing event from any source, with running-balance drill when a single item is selected. Sources legacy aggregates:

| # | source | direction | from table |
|---|---|---|---|
| 1 | Store Transactions (manual receipts, adjustments) | IN/OUT | `db.storeTransactions` |
| 2 | GRN — goods received | IN | `db.grn` |
| 3 | Item Issues | OUT | `db.storeIssues` |
| 4 | Tool Issues (issue + return) | OUT then IN | `db.toolIssues` |
| 5 | Dispatch | OUT | `db.challans` |
| 6 | OSP DC (outward + inward) | OUT then IN | `db.ospDC` |

In React, the canonical pattern is: every stock-changing event writes to `store_transactions` with `source` + `ref_no` + `stock_before` / `stock_after`. The "Stock Ledger" then just queries that one table. The multi-source-merge legacy does is unnecessary.

---

## 1. KPI strip (L25086–25092) — 5 tiles

| # | tile | colour | value |
|---|---|---|---|
| 1 | Transactions | cyan | `filtered.length` |
| 2 | Total IN | green | Σ qty where type=IN |
| 3 | Total OUT | red | Σ qty where type=OUT |
| 4 | Net | green if ≥0 else red | totalIn - totalOut |
| 5 | Items | text | `uniqueItems.size` |

---

## 2. Filter bar (L25094–25103)

| field | input | reset value |
|---|---|---|
| Item | datalist of `db.items` | empty |
| From | date | empty |
| To | date | empty |
| Type | select IN / OUT / All | empty |
| ↻ Clear | reset button | — |
| ⬇ Excel | export | — |

---

## 3. Running balance view (L25107–25127)

When item filter is set, a **separate panel above the main table** shows:

- Header: `📊 <itemCode> — <itemName> (Current Stock: <stockQty> <uom>)`
- 7-col table: Date · Type · Qty · **Running Balance** (cyan) · Source · Ref No · Remarks
- Computed by iterating oldest→newest, accumulating `runBal += qty (IN) or -= qty (OUT)`, then reversing for display.

---

## 4. Main ledger table (L25130) — 8 columns (capped at 500 rows)

| col | header | colour |
|---|---|---|
| 1 | Date | 11px |
| 2 | Item | purple bold 12px |
| 3 | Name | 11px |
| 4 | Type | IN/OUT pill (green/red bg+text) |
| 5 | **Qty** | mono bold, +N green / -N red |
| 6 | Source | blue 11px |
| 7 | Ref No. | mono 11px |
| 8 | Remarks | text3 ellipsis 250px |

---

## 5. React side — compare against current `/store-transactions`

React file header doesn't claim legacy parity. Verify against the existing implementation:

| element | legacy | React (likely) | tag |
|---|---|---|---|
| Header | `📦 Stock Ledger` (verify) | "Store Transactions" or similar | **POLISH** |
| KPI strip | 5 tiles | ❌ likely missing | **BLOCKER** (operational metric) |
| Filter bar | Item datalist + From/To + Type + Excel | ⚠️ React has `txnType` + `sourceType` selects + search | **DELTA** — Item datalist is a richer UX |
| Running balance view (item-selected) | Yes | ❌ likely missing | **BLOCKER** (the key insight for any item-level investigation) |
| Excel export | Yes | ❌ likely missing | **DELTA** (project-wide gap) |
| Per-row remarks | ellipsis 250px with title tooltip | verify | **POLISH** |
| Multi-source merge | aggregates 6 sources at render time | ✅ store_transactions IS the canonical merge — React queries that one table | ✅ |

---

## 6. Summary

### BLOCKERs (assuming React's current /store-transactions is a simpler list)
1. **5-tile KPI strip** above the table (Txn count, IN, OUT, Net, Items).
2. **Running balance panel** when a single item is selected.
3. **Item datalist filter** (much richer than the existing sourceType/txnType selects).

### DELTAs (workable today)
4. ↻ Clear filters button.
5. Excel export.
6. 500-row display cap (vs paged) — React paging handles this differently.

### POLISH
- Header label match `📦 Stock Ledger`.
- Per-row remarks tooltip.
- IN/OUT pill styling.

---

**Sign-off needed:**
- Audit the current /store-transactions vs §5 to confirm BLOCKERs.
- Confirm aggregation model: keep React's "everything writes to store_transactions" pattern (yes — cleaner than legacy merge). Add item-based running balance as a new endpoint or compute client-side from filtered rows.
