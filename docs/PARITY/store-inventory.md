# PARITY — Store / Inventory (`renderStore`)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L24803–24912. Helpers: `storeAdjust` L24914, `storeSetMin` L24945, `storeHistory` L24953, `storeReceiveManual` L24981.
> **React target:** ❌ **WHOLE PAGE MISSING.** No `/store` route. The existing `/store-transactions` is the ledger (Stock Ledger), not this consolidated inventory view.

---

## 0. What this page is

The **operational stock dashboard** — one row per item with current stock + min level + on-PO + manufacturing-pending. Per-row actions: ± Adjust, Min Qty, History. 4 click-to-filter stat tiles. Recent-transactions sidebar.

Distinct from:

- Stock Ledger (per-transaction event log) — covered separately
- Item Master (item-definition CRUD; no qty)

---

## 1. KPI strip (L24876–24891) — 4 tiles

| #   | tile                | colour | counts                                                   | click filter       |
| --- | ------------------- | ------ | -------------------------------------------------------- | ------------------ |
| 1   | Total Items         | cyan   | `totalItems` + sub `<N> total pieces in store`           | `_storeFlt='all'`  |
| 2   | Items in Stock      | green  | items with `stockQty > 0`                                | (non-clickable)    |
| 3   | **Low Stock Alert** | red    | items with `minStockQty > 0 AND stockQty <= minStockQty` | `_storeFlt='low'`  |
| 4   | Zero Stock          | amber  | items with `stockQty === 0`                              | `_storeFlt='zero'` |

---

## 2. Toolbar (L24868–24875)

- Header `🏬 Store / Inventory`
- Search input (item / material)
- "+ Manual Receipt" primary button → `storeReceiveManual()` modal

---

## 3. Main table (L24895–24902) — 9 cols

| col | header          | colour                                            |
| --- | --------------- | ------------------------------------------------- |
| 1   | Item Code       | purple code                                       |
| 2   | Name            | bold                                              |
| 3   | Material        | text2                                             |
| 4   | UOM             | tag                                               |
| 5   | **In Stock**    | green / red if 0; **⚠ LOW** sub-line if below min |
| 6   | Min Qty         | mono text3                                        |
| 7   | **On PO**       | blue mono (Σ open PO qty - received)              |
| 8   | **Mfg Pending** | amber mono (Σ open JC pending qty)                |
| 9   | Actions         | ± Adjust · Min Qty · History                      |

Per-row tint: `rgba(220,38,38,0.04)` red wash when `lowStock`.

Filter banner shown when active filter ≠ 'all' + "Show All" reset.

Footer hint: `💡 Stock is automatically updated via GRN (inward) and Dispatch (outward). Use ± Adjust for manual corrections.`

---

## 4. Recent transactions panel (L24903–24907)

Last 10 `store_transactions` reversed, in a compact 7-col table: `Date · Type · Item · Qty · Source · Ref No · Remarks`. Only rendered when there's at least 1 transaction.

---

## 5. Action modals

### 5.1 `storeAdjust(itemCode)` (L24914)

Header shows current stock prominently. Inputs: type (+Add / -Remove), qty ★, reason/remarks ★. On save: validates non-zero qty + reason; if 'remove', validates `qty <= stockQty`. Pushes a `store_transactions` row with `source='Manual Adjustment'`, refNo `ADJ-<short uid>`. Activity log `STOCK ADJUST`.

### 5.2 `storeSetMin(itemCode)` (L24945)

Browser `prompt()` for min stock level. Simple — could be inlined in row or a small modal.

### 5.3 `storeHistory(itemCode)` (L24953)

Large modal — 3-tile context header (current stock, min level, txn count) + 7-col history table (Date · Type · Qty · Source · Ref · Remarks · Stock B→A). Reuses the same per-transaction shape.

### 5.4 `storeReceiveManual()` (L24981)

Modal: Item ★ (datalist), Qty ★, Source (Production / Purchase / Return / Other), Ref No, Remarks. Adds to stock + pushes `store_transactions` (type='IN'). Activity log `STOCK IN`.

---

## 6. Data model

Mostly uses the **existing** schema:

- `items` (master)
- `store_transactions` (already exists — used by Stock Ledger)

Adds one **new column** to `items`:

- `min_stock_qty integer NOT NULL DEFAULT 0` — for low-stock alert math

Computed columns (per-row):

- `on_po_qty` = Σ `purchase_order_lines.qty - GRN.received` where item_id matches and PO status≠'closed'
- `mfg_pending_qty` = Σ JC pending (order_qty - completed) for open JCs on this item

Both could be derived in the list endpoint via subqueries (similar to Item Tracker report which already computes the same).

---

## 7. Required new schema (minimal)

```sql
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS min_stock_qty integer NOT NULL DEFAULT 0;
```

That's it — everything else is computed.

---

## 8. Summary — building from scratch

### BLOCKERs

1. `items.min_stock_qty` column (migration).
2. New endpoint `GET /store-inventory` returning per-item rollup + 4 stat counts (or compute on the client from cached items data, but server-side is cleaner).
3. List page with 4-KPI strip + 9-col table + filter logic.
4. 4 action modals (Adjust, Set Min, History, Manual Receipt).
5. Recent Transactions panel under the main table.
6. Sidebar entry "📦 Store / Inventory" under Store → Report.

### DELTAs

7. History modal is essentially a per-item stock_transactions filter — could route to `/store-transactions?itemCode=X` instead of opening a modal.
8. Activity-log emission for STOCK ADJUST / STOCK IN events.

### POLISH

- Per-row red wash for low-stock rows.
- ⚠ LOW sub-text under stock qty.

---

**Sign-off needed:**

- Confirm scope. Estimate ~700 LOC + 1 schema migration.
- Decide: action via modal or route? (Recommend: modal for Adjust + Set Min, route for History.)
- Confirm new column placement (`items.min_stock_qty`).
