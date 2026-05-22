# PARITY — Pending SO Value (`renderPendingSOValue`)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L19272–19380. Helper: `_psvDetail(soNo)` L19382+, `_psvExportExcel`.
> **React target:** ❌ **WHOLE PAGE MISSING.** No `/pending-so-value` route.
> **Status:** ❌ entire feature absent; gated by missing `invoices` table.

---

## 0. What this page is

A **revenue-pipeline report** showing every SO's order value, dispatched value, pending value, invoiced value, received value, and outstanding amount. Used by finance/management to track cashflow.

---

## 1. Page chrome (L19322–19331)

| # | Element | Legacy | Tag |
|---|---|---|---|
| 1 | Section header | `💰 Pending SO Value` | needs port |
| 2 | Filter buttons (4) | `Open / Pending · All SOs · Overdue · Completed` (window-state `_psvFilter`) | **BLOCKER** |

---

## 2. KPI cards (L19333–19340) — 5 cards in auto-fit grid

| # | label | value | colour | sub |
|---|---|---|---|---|
| 1 | TOTAL ORDER VALUE | `₹ N` IN-formatted | cyan 16px mono | `<N> SOs` |
| 2 | DISPATCHED VALUE | `₹ N` | green 16px | `<%> of order` |
| 3 | **PENDING DISPATCH** (2px amber border) | `₹ N` | amber 18px | `<%> of order` |
| 4 | INVOICED | `₹ N` | teal `#0d9488` | `<%> of dispatched` |
| 5 | OUTSTANDING | `₹ N` | red if >0 else green | `<%> of invoiced` |

---

## 3. Table (L19345–19375) — 11 cols + totals row

| # | header | data | format |
|---|---|---|---|
| 1 | SO No | `so.soNo` | mono cyan bold |
| 2 | Customer | `so.customer` | text |
| 3 | SO Date | `fmt(soDate)` | 11px centered |
| 4 | Due Date | `fmt(dueDate)` + `⚠` if overdue | red if overdue |
| 5 | Order Value | `inr` | mono right-aligned |
| 6 | Dispatched | `inr` | green mono right |
| 7 | **Pending Value** | `inr` | amber mono right bold |
| 8 | Invoiced | `inr` | teal mono right |
| 9 | Received | `inr` | green mono right |
| 10 | Outstanding | `inr` | red if >0 else green |
| 11 | Status | `badge(status)` | — |

Row click → `_psvDetail(soNo)` modal showing line-level breakdown.

Sort: by `pendingValue` descending.

Totals row: bold, `bg4` background, columns 5–10 totaled.

Footer hint: `💡 Click any SO row to see line-level breakdown. Pending Value = Order Value − Dispatched Value.`

⬇ Export to Excel button — `_psvExportExcel()`.

---

## 4. Math (L19279–19303)

Per-line:
- `lineValue = qty * rate`
- `dispQty = SUM(dispatchLog.qty where soNo + itemCode match)`, capped at `qty`
- `dispValue = dispQty * rate`
- `pendValue = (qty - dispQty) * rate`

Per-SO:
- `orderValue = Σ lineValue`
- `dispatchedValue = Σ dispValue`
- `pendingValue = Σ pendValue`
- `invoicedValue = Σ db.invoices.grandTotal where invoice.soNo === soNo`
- `receivedValue = Σ db.invoices.totalPaid`
- `outstandingValue = invoicedValue - receivedValue`

---

## 5. Required new schema — `invoices` table

This module is **gated by an `invoices` table** that doesn't exist in current schema. Fields needed:

```
invoices (
  id uuid PK,
  company_id uuid,
  invoice_no text,
  so_id uuid FK→sales_orders,
  invoice_date date,
  grand_total numeric,
  total_paid numeric,
  ...
)
invoice_lines (
  id uuid PK,
  invoice_id uuid FK,
  item_id uuid FK,
  qty integer,
  rate numeric,
  ...
)
```

---

## 6. Summary

### BLOCKERs
1. **`invoices` + `invoice_lines` schema** + RLS.
2. **Aggregation endpoint** `GET /pending-so-value?filter=open|all|overdue|completed` → returns row list + totals.
3. **Filter buttons + 5-tile KPI strip + 11-col table + totals row**.
4. **Per-SO drill modal** (`_psvDetail`).
5. **Excel export**.

### DELTAs
- Drill modal could be a separate `/sales-orders/$id/pending-value` route instead of a modal.

### POLISH
- `₹ N` IN-formatting via `Intl.NumberFormat('en-IN')`.
- 2-px amber border on the Pending tile.

---

**Sign-off needed:**
- Confirm `invoices` is in the migration plan. If not, this module can't ship.
- Estimate: ~600 LOC (schema + service + endpoint + UI + modal + export). Pair with broader Finance module work.
