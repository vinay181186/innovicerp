# PARITY — Item Issue Register (`renderIssueRegister`)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L23874–23905. Helpers: `addIssue` L23914, `_nextIssueNo` L23907, `_issueItemFill` L23950. Numbering: `ISS-NNNNN`.
> **React target:** ❌ **WHOLE PAGE MISSING.** No `/issue-register` route. No `store_issues` table in current schema (but `store_transactions` exists — see §3).
> **Status:** ❌ entire feature absent.

---

## 0. What this page is

Daily-use **production-floor consumable register** — operator/shop foreman issues item X from store to a JC or to maintenance, stock auto-decrements. Distinct from Tool Issue (returnable) which is a separate page.

Schema fields used (`db.storeIssues[*]`):
- `issueNo` (auto `ISS-NNNNN`)
- `issueDate`
- `itemCode`, `itemName`
- `qty`
- `issuedTo` (free-text: person / dept / machine)
- `refType` (Job Card / SO / Production / Maintenance / Other), `refNo`
- `purpose` (free-text)
- `remarks`
- `issuedBy` (user)

---

## 1. Page chrome (L23892–23898)

| # | Element | Legacy | Tag |
|---|---|---|---|
| 1 | Section header | `📋 Item Issue Register` | needs port |
| 2 | Search input | "Search issue, item, JC…" | **BLOCKER** |
| 3 | + New Issue button | `addIssue()` modal | **BLOCKER** |

---

## 2. List table (L23899–23902) — 10 columns

| col | header | data | format |
|---|---|---|---|
| 1 | Issue No. | `issueNo` | cyan code |
| 2 | Date | `fmt(issueDate)` | text2 11px |
| 3 | Item Code | `itemCode` | purple code |
| 4 | Item Name | name from `items` lookup | default |
| 5 | Qty | `n(qty)` | mono bold 14px |
| 6 | Issued To | `issuedTo` | default |
| 7 | Reference | `refType refNo` | purple mono |
| 8 | Purpose | `purpose` | text3 11px |
| 9 | Remarks | ellipsis 100px | text3 |
| 10 | Issued By | `issuedBy` | text3 |

Empty state: "No issues recorded — click + New Issue".

Footer hint: `💡 Item Issue Register tracks material/consumables issued from Store. Stock is auto-deducted. For returnable tools, use Tool Issue Register.` (with link)

---

## 3. addIssue modal (L23914–23948) — 8 fields

| pos | field | type | required | hint |
|---|---|---|---|---|
| 1 | Issue No. | readonly | — | auto `ISS-NNNNN` |
| 2 | Date | date | — | default today |
| 3 | **Item ★** | datalist of `db.items` | ★ | autofills name + current stock display |
| 4 | **Qty to Issue ★** | number | ★ ≥1 | validates against `item.stockQty` |
| 5 | **Issued To ★** | text | ★ | placeholder "Person / Dept / Machine" |
| 6 | Reference Type | select | — | Job Card / SO / Production / Maintenance / Other |
| 7 | Reference No. | text | — | e.g. JC-00001, SO-001 |
| 8 | Purpose | text | — | placeholder "Manufacturing / Testing / Repair" |
| 9 | Remarks | text full | — | — |

**Side effects on save:**
- Validates `qty <= item.stockQty` (insufficient-stock toast)
- Pushes a `store_transactions` row (type='OUT', source='Issue', stockBefore/stockAfter)
- Pushes a `store_issues` row
- Decrements `item.stockQty` by qty
- `logActivity('ISSUE', 'Store', ...)`

---

## 4. Required new schema

In the current React/Drizzle codebase, the closest table is `store_transactions` (already exists, used by Stock Ledger). The legacy split is:
- `store_transactions` — generic in/out ledger entries (1:1 with stock movement)
- `store_issues` — Issue-specific metadata (refType, purpose, issuedTo, issuedBy)

**Two options for React port:**

A) **New `store_issues` table** mirroring legacy shape (gets its own `ISS-NNNNN` number series + the issue-specific metadata). Cleaner but +1 table.

B) **Extend `store_transactions`** with `issued_to`, `purpose`, `ref_type`, `ref_no` columns (already has `source` for the txn type). Single table, but mixes generic ledger with issue-specific fields.

Recommend **Option A** (separate table) — matches legacy and keeps store_transactions slim. Issue creates *both* a store_transactions row (the ledger entry) and a store_issues row (the issue-specific metadata).

```
store_issues (
  id uuid PK,
  company_id uuid,
  code text (ISS-NNNNN),
  issue_date date,
  item_id uuid FK, item_code_text text, item_name text,
  qty integer,
  issued_to text,
  ref_type text enum (job_card | so | production | maintenance | other),
  ref_no text,
  purpose text,
  remarks text,
  store_transaction_id uuid FK (links to the ledger entry),
  created/created_by/updated/updated_by/deleted_at standard
)
```

---

## 5. Summary — building from scratch

### BLOCKERs
1. `store_issues` table + migration + RLS
2. POST /store-issues endpoint with stock-check + atomic txn + ledger emit
3. GET /store-issues list endpoint
4. Page: 10-col list + + New Issue button + search
5. New Issue modal: 8 fields + item-stock-display + qty validation
6. Auto-decrement `item.stockQty` on issue (via store_transactions consumer)
7. Sidebar entry "📋 Item Issue Register" under Store → Entry

### DELTAs
8. Excel template + import — defer (project-wide Excel gap)
9. Activity-log emission — verify shared helper handles 'ISSUE' kind

### POLISH
- Footer hint with link to Tool Issue Register
- Item picker auto-fill of stock display

---

**Sign-off needed before code:**
- Confirm Option A schema (separate `store_issues` table). Estimate ~600 LOC end-to-end.
- Confirm number prefix `ISS-NNNNN`.
- Confirm `ref_type` enum values match legacy.
