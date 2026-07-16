# Store Issues (Item Issue Register)
**Module key:** `store-issues` · **Domain:** Procurement & Store

## Purpose
Daily-use consumable / item issue register — records stock going OUT of the store to a person, department, or against a reference. Each issue decrements item on-hand by writing an `out` store-transaction. Numbering: `ISS-NNNNN` (server-generated). Mirrors legacy `renderIssueRegister` / `addIssue`.

## Pages / Screens
- `apps/web/src/modules/store-issues/routes/list.tsx` — issue register list (search/item/date filters)

## Database Tables
**`store_issues`** (owned) — schema.ts L2829
- Key cols: `code` (unique per company, `ISS-NNNNN`), `issue_date`, `item_id` (FK items, set null)/`item_code_text`/`item_name`, `qty`, `issued_to` (notNull), `ref_type`, `ref_no`, `purpose`, `remarks`, `store_transaction_id` (FK store_transactions, set null — back-link to the ledger row).
- Indexes: unique `(company_id, code)`; `(company_id, issue_date)`; `(company_id, item_id)` — where not deleted.
- `company_id` + audit; RLS `company_read` + `manager_write`.

Also **writes** `store_transactions` (`txn_type='out'`, `source_type='other'`).

## API Endpoints
routes.ts (authenticated):
- `GET /store-issues` — list (search, itemId, fromDate, toDate)
- `POST /store-issues` — create issue → 201

Create-only (no update/delete endpoints — corrections via a reversing adjustment).

## Services / Key Functions
service.ts:
- `nextStoreIssueCode(tx, companyId)` — MAX(code suffix)+1, `ISS-` padded 5, inside the insert tx.
- `listStoreIssues(input, user)` — raw SQL, item + issuer (users.full_name) joins.
- `createStoreIssue(input, user)` → StoreIssue — **transaction**:
  1. Load item; **lock items row `FOR UPDATE`** (prevents double-spend).
  2. Read on-hand from `v_item_stock`; **reject if qty > on-hand** (ConflictError insufficient stock).
  3. Allocate `ISS-NNNNN`.
  4. Insert `store_transactions` (`out`, `source_type='other'`, stock_before/after, remarks) first, capture its id.
  5. Insert `store_issues` row with `store_transaction_id` back-link.

## Entry Points
- `storeIssuesRoutes` (Fastify). Writes the `out` ledger row that the item_stock_balances trigger applies to on-hand.

## Business Logic
- **Stock OUT ledger:** every issue produces exactly one `out` store-transaction; on-hand falls via the trigger. The issue row keeps a FK to that ledger row.
- **Stock guard:** cannot issue more than currently on-hand; the `FOR UPDATE` lock serializes concurrent issues on the same item.
- **Server-side numbering** inside the tx (uniqueIndex backstop) avoids code collisions.
- **Reference fields** (`ref_type`/`ref_no`/`issued_to`/`purpose`) capture who/what the material was issued against — free-text, not a strong FK.

## Dependencies on Other Modules
- items (stock source + lock), store-transactions (ledger writer + on-hand via v_item_stock), users (issuer name display).

## User Roles / Access
Read: any company user. Create: admin/manager (RLS `manager_write` + store_transactions insert policy). (Enforced by RLS; no explicit requireWriteRole in service.)

## Reports
List register with per-item / date filtering.

## Imports / Exports
None.

## Background Jobs
None.
