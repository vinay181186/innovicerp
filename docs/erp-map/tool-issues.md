# Tool Issues (Returnable Items Register)
**Module key:** `tool-issues` · **Domain:** Catalog & Engineering

## Purpose
Register of returnable items — tools, inserts, fixtures — issued out of the store and tracked until returned. Issuing decrements stock; returns are split into Good / Damaged / Consumed, where only Good qty restores stock. Supports partial returns across multiple return events.

## Pages / Screens
Web routes under `apps/web/src/modules/tool-issues/routes/`:
- `tool-issues` (list.tsx) — filterable list (all / out / overdue / returned) with search + 4 summary tiles (total, out, returned, overdue); issue + record-return actions.

## Database Tables
- `tool_issues` (schema.ts L2715) — header: `code`, `issue_date`, `expected_return_date`, `item_id` (→items, nullable) + `item_code_text` + `item_name`, `qty`, `issued_to`, `ref_type`, `ref_no`, `purpose`, `remarks`, `return_status` (text, default 'issued'), cumulative `return_good_qty` / `return_damaged_qty` / `return_consumed_qty`, `store_transaction_id` (→store_transactions). Unique `tool_issues_company_code_uniq`. Indexes on company+issue_date, company+return_status.
- `tool_issue_returns` (L2776) — one row per return event: `tool_issue_id` (→tool_issues, cascade), `return_date`, `returned_by`, `good_qty` / `damaged_qty` / `consumed_qty`, `remarks`, `store_transaction_id`. Index on (tool_issue_id, return_date).

Both: `company_id`, audit columns, soft delete, RLS company_read / manager_write.

## API Endpoints
`routes.ts` (auth required):
- GET `/tool-issues` — list (`listToolIssuesQuerySchema`: search, filter, limit, offset).
- POST `/tool-issues` — create an issue (201).
- POST `/tool-issues/:id/return` — record a return against an issue.

## Services / Key Functions
`service.ts` (all in `withUserContext` tx):
- `listToolIssues(query, user)` → items + total + summary tiles. Raw SQL with derived `isOverdue`; joins issuer name; filter set all/out/overdue/returned.
- `createToolIssue(input, user)` → ToolIssue — validates item, `SELECT ... FOR UPDATE` locks item, checks stock, writes an `out` store_transactions row, inserts the issue (status 'issued').
- `recordToolReturn(toolIssueId, input, user)` → ToolIssue — validates no overshoot, restores Good qty via an `in` store_transactions row, inserts a return event, updates cumulative counters + status.

## Entry Points
Nav → Tool Issues. Store/inventory is the stock source; returns feed back into the same `store_transactions` ledger used by GRN/store issues.

## Business Logic
- Code auto-generated `TIS-NNNNN` (next numeric suffix per company).
- **Issue**: requires sufficient on-hand stock (read from `v_item_stock.on_hand_qty`); insufficient → ConflictError. Emits an `out` `store_transactions` row (sourceType 'other', remark "Tool Issue ... (Returnable)"); stock decremented. Item row locked `FOR UPDATE` to serialize concurrent issues.
- **Return**: total this return (good+damaged+consumed) plus already-returned may not exceed issued qty (ConflictError on overshoot). Cannot return an already fully-returned issue. Only **Good** qty produces an `in` store_transactions row that restores stock; Damaged + Consumed are permanent removals (counters only).
- **Status machine**: after each return, `totalReturned = good+damaged+consumed` → 0 = 'issued', < qty = 'partial', >= qty = 'returned'. Issued qty never changes after creation.
- **Overdue** is derived, never stored: `return_status <> 'returned' AND expected_return_date < today`.
- `returned_by` defaults to the original `issued_to` when omitted.
- Soft delete only. No activity-log emission in this module.

## Dependencies on Other Modules
- `items` — issued item (id/code/name) + stock lookup (`v_item_stock` view).
- `store-transactions` — append-only stock ledger for both out (issue) and in (Good return) movements.
- `users` — issuer name display.

## User Roles / Access
- Read: any authenticated company user (RLS company_read).
- Issue / record return: admin/manager (RLS manager_write; note services here rely on company context + RLS rather than an explicit `requireWriteRole` call).

## Reports
List summary tiles (total / out / overdue / returned) act as the operational register report. No file export.

## Imports / Exports
None.

## Background Jobs
None (overdue computed on read).
