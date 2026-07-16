# Customer Dispatches
**Module key:** `customer-dispatches` · **Domain:** Dispatch, Finance & Design

## Purpose
Records dispatch of ready (produced + QC-accepted) finished-goods quantity against Sales Order lines — the customer **Dispatch Register**. This is the gate that feeds invoicing: a line can only be invoiced up to what has been dispatched. Maintains `sales_order_lines.dispatched_qty` and moves finished-goods stock out of inventory. Migration 0050; mirrors legacy `dispatchLog` / `renderDispatchRegister`.

## Pages / Screens
- **List / Dispatch Register** (`apps/web/src/modules/customer-dispatches/routes/list.tsx`) — header list plus the line-grain Dispatch Register with item-wise stock summary.
- **Create** (`routes/create.tsx`) — pick an SO, then dispatch available qty per line.
- No dedicated detail route in web; detail is served by the API for the create/register flows.

## Database Tables
Owned/written (`apps/api/src/db/schema.ts`):

- **`customer_dispatches`** (header). Key cols: `code` (DSP-NNNN), `dispatch_date`, `sales_order_id` (FK → `sales_orders`, NOT NULL), `so_code_text`, `customer_text`, `transport`, `vehicle_no`, `status` (`customer_dispatch_status` enum: `dispatched` | `cancelled`, default `dispatched`), `remarks`.
  - Indexes: unique `(company_id, code)` where not deleted; `(company_id, sales_order_id)`; `(company_id, dispatch_date)`.
- **`customer_dispatch_lines`**. Key cols: `customer_dispatch_id` (FK, cascade delete), `line_no`, `sales_order_line_id` (FK → `sales_order_lines`, set null), `item_id` (FK → `items`, set null), `item_code_text`, `item_name`, `qty` (integer, CHECK `qty > 0`).
  - Indexes: unique `(customer_dispatch_id, line_no)` where not deleted; `(sales_order_line_id)` partial.

Both tables carry `company_id`, `created_at/by`, `updated_at/by`, `deleted_at`, RLS enabled. Policies: `*_company_read` (select where `company_id = current_company_id()`); `*_manager_write` (all ops for role admin/manager in-company).

## API Endpoints
`apps/api/src/modules/customer-dispatches/routes.ts` — all require authentication.

- `GET /customer-dispatches` — list dispatch headers with line count + total qty.
- `GET /customer-dispatches/register` — line-grain Dispatch Register (CPO Ln, UOM, Dispatched By, Stock Before→After, JC No., current stock).
- `GET /customer-dispatches/so-options` — non-cancelled SO options for the picker.
- `GET /customer-dispatches/dispatchable/:soId` — per-line readiness (ready − already dispatched) for an SO.
- `GET /customer-dispatches/:id` — dispatch detail with lines.
- `POST /customer-dispatches` → 201 — create dispatch (write role: admin/manager).
- `POST /customer-dispatches/:id/cancel` — cancel dispatch (write role: admin/manager).

## Services / Key Functions
`service.ts` (public):
- `listFinanceSoOptions(user)` → `FinanceSoOption[]` — non-cancelled SOs.
- `getDispatchableSo(soId, user)` → SO header + dispatchable lines.
- `listDispatches(user)` → headers + aggregated line count/total qty.
- `listDispatchRegister(user)` → line-grain register rows (raw SQL join across dispatch lines, SO lines, users, store_transactions, `v_item_stock`, job_cards).
- `getDispatch(id, user)` → detail with lines.
- `createDispatch(input, user)` → detail. **Transactional** via `withUserContext`; requires write role.
- `cancelDispatch(id, user)` → detail. **Transactional**; requires write role.

Internal helpers: `moveDispatchStock` (writes a `store_transactions` row, `apply_store_txn_to_balance` trigger updates `item_stock_balances`), `loadDispatchable`, `loadSo`, `nextCode`, `getDispatchInternal`.

## Entry Points
- API registered via `customerDispatchesRoutes(app)`.
- Web hooks in `apps/web/src/modules/customer-dispatches/api.ts`; helpers in `lib/`.

## Business Logic
- **Dispatch Register (readiness):** per SO line, "ready" = the final operation's effective output summed across the line's job cards, minus already-dispatched. Effective output rule (from `v_jc_op_status`, DISTINCT ON last op by `op_seq DESC`):
  - QC op or `qc_required` → `qc_accepted_qty`;
  - `outsource` op complete → `input_avail`, else outsource → 0;
  - otherwise → `completed_qty`.
  - `availableQty = max(0, ready − dispatchedQty)`.
- **Create** validates each line belongs to the SO and `qty ≤ availableQty` (else `ConflictError`). Allocates `DSP-NNNN` (max numeric suffix + 1), inserts header + lines, then per line:
  1. increments `sales_order_lines.dispatched_qty` by qty;
  2. writes a `store_transactions` row `txn_type='out'`, `source_type='dispatch'`, `source_ref='<code> / ln <n>'` (finished goods out; skips free-text lines with no `item_id`).
  - Emits activity log `CREATE / Dispatch`.
- **Cancel** blocks if already cancelled. Per line: decrements `dispatched_qty` (floored at 0 via `GREATEST`) and writes a compensating `store_transactions` `txn_type='in'` (reversal) row; sets header `status='cancelled'`. Emits `CANCEL / Dispatch`.
- Register `Stock Before→After` is read back from the `out` `store_transactions` row keyed by `source_ref`; `current_stock` from `v_item_stock` for the item-wise summary panel.

## Dependencies on Other Modules
- **Sales Orders** — reads `sales_orders` / `sales_order_lines`; writes `dispatched_qty`.
- **Job Cards / JC Ops** — readiness from `v_jc_op_status` + `job_cards`.
- **Store / Inventory** — writes `store_transactions`; reads `v_item_stock` (trigger `apply_store_txn_to_balance` maintains `item_stock_balances`).
- **Invoices** — downstream; invoicing is capped at dispatched qty.
- **Activity Log** — `emitActivityLog`.

## User Roles / Access
- Read: any authenticated user in the company (RLS `company_read`).
- Create / cancel: `requireWriteRole` → **admin** or **manager** only (also enforced by RLS `manager_write`).

## Reports
- Dispatch Register (line-grain) with item-wise current-stock summary; header list with totals.

## Imports / Exports
- No file import/export in this module.

## Background Jobs
None.
