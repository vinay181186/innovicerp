# PARITY — Tool Issue Register (Returnable) (`renderToolIssue`)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L23965–24036. Helpers: `addToolIssue` L24038, `_toolReturn` L24080, `_tisItemFill` L24073. Numbering: `TIS-NNNNN`.
> **React target:** ❌ **WHOLE PAGE MISSING.** No `/tool-issue` route; no `tool_issues` table.
> **Status:** ❌ entire feature absent.

---

## 0. What this page is

Returnable counterpart to Item Issue Register. Issues tools / inserts / spanners / fixtures to a person/dept/machine with an **expected return date**. On return, breaks the qty into **Good (back to stock) / Damaged / Consumed** — only Good restores stock.

Schema (`db.toolIssues[*]`):
- `issueNo` (`TIS-NNNNN`)
- `issueDate`, `expectedReturnDate`
- `itemCode`, `itemName`, `qty`
- `issuedTo`, `refType`, `refNo`, `purpose`, `remarks`, `issuedBy`
- `returnStatus`: `'issued' | 'partial' | 'returned'`
- `returnGood`, `returnDamaged`, `returnConsumed` (cumulative)
- `returns[]` — per-return-event log

---

## 1. KPI stat strip (L24012–24017) — 3 or 4 tiles

| # | tile | colour | counts | click filter |
|---|---|---|---|---|
| 1 | Total | blue | `issues.length` | `tisFilter='all'` |
| 2 | Currently Out | red | `returnStatus !== 'returned'` (issued + partial) | `tisFilter='out'` |
| 3 | Returned | green | `returnStatus === 'returned'` | `tisFilter='returned'` |
| 4 | **Overdue** (only if > 0) | red bg+border | currently-out AND `expectedReturnDate < today` | `tisFilter='overdue'` |

---

## 2. Toolbar (L24019–24029)

- Search input (issueNo, itemCode, name, issuedTo, refNo)
- Filter select: All / Currently Out / Overdue / Returned
- + Issue Tool primary button → `addToolIssue()` modal

---

## 3. Table (L24031–24032) — 12 columns

| col | header | colour |
|---|---|---|
| 1 | Issue No. | cyan code |
| 2 | Date | text2 11px |
| 3 | Item | purple code + name below |
| 4 | Qty | mono bold 14px |
| 5 | Issued To | text 12px |
| 6 | Ref | purple mono (refNo) |
| 7 | Exp Return | text2 11px |
| 8 | Status | badge (Returned✓ green / Partial cyan / Overdue red / Issued amber) |
| 9 | **Good** | mono green |
| 10 | **Dmg** | mono red |
| 11 | **Used** | mono amber |
| 12 | Action | ↩ Return button (when not fully returned) |

Per-row tint: overdue rows get `rgba(239,68,68,0.03)` red wash.

Footer hint: `🔧 Tool Issue Register tracks returnable items (tools, inserts, spanners, fixtures). Return button records Good/Damaged/Consumed breakdown. Good qty added back to stock.`

---

## 4. addToolIssue modal (L24038–24071) — 10 fields

Same as Item Issue modal +:
- **Expected Return Date ★** (date, required)

Side effects: pushes a `store_transactions` row (`type='OUT'`, `source='Tool Issue'`), pushes `tool_issues` row with `returnStatus='issued'`, decrements `item.stockQty`. `logActivity('TOOL_ISSUE','Store',...)`.

---

## 5. _toolReturn modal (L24080–end)

Shows current issue context (item, issued qty/to/date) + already-returned breakdown if any.

3 inputs (max `remaining`):
- **Returned Good** (green, restores stock)
- **Damaged** (red, doesn't restore)
- **Consumed** (amber, doesn't restore)

Validates `good + dmg + consumed <= remaining`. On save:
- Adds Good qty back to `item.stockQty` (and emits store_transactions `IN` row, source='Tool Return')
- Increments tool_issues cumulative counters
- Pushes a `returns` event row with breakdown + date + by
- Recomputes `returnStatus`: returned (totalReturned === issuedQty) | partial (some) | issued (none)

---

## 6. Required new schema

```
tool_issues (
  id uuid PK, company_id, code (TIS-NNNNN),
  issue_date, expected_return_date,
  item_id FK, item_code_text, item_name,
  qty integer,
  issued_to, ref_type, ref_no, purpose, remarks,
  return_status enum ('issued','partial','returned'),
  return_good integer, return_damaged integer, return_consumed integer,
  audit envelope
)
tool_issue_returns (
  id uuid PK, company_id, tool_issue_id FK,
  return_date, returned_by,
  good_qty, damaged_qty, consumed_qty,
  remarks, store_transaction_id FK,
  audit envelope
)
```

---

## 7. Summary — building from scratch

### BLOCKERs
1. Schema (2 tables + indexes + RLS).
2. CRUD endpoints (issue + return).
3. List page with 3-or-4 KPI tiles + filter + search + 12-col table.
4. Issue modal (10 fields).
5. Return modal (3-way breakdown with stock cascade).
6. Sidebar entry "🔧 Tool Issue Register" under Store → Entry.

### DELTAs
7. Activity-log emission for TOOL_ISSUE + TOOL_RETURN kinds.
8. Overdue tint colour on table row.

### POLISH
- Footer hint
- Item picker auto-fill of stock display

---

**Sign-off needed:**
- Confirm scope (~700 LOC). Pair with Item Issue Register for one slice — both touch store_transactions.
- Confirm `TIS-NNNNN` prefix.
- Decide on 3-state vs 2-state return status (legacy has issued / partial / returned).
