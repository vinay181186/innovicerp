# Invoices
**Module key:** `invoices` · **Domain:** Dispatch, Finance & Design

## Purpose
Full tax-invoice creation and payment tracking on the sales side. An invoice is raised against a Sales Order; each line's invoiceable quantity is gated on **dispatched − already-invoiced** qty. Tracks GST, grand total, cumulative payments, balance, due date, and overdue state; feeds the Pending SO Value / cashflow reporting. Migration 0050; mirrors legacy `renderInvoices` / `_createInvoice` / `_addPayment`.

## Pages / Screens
`apps/web/src/modules/invoices/routes/`:
- **List** (`list.tsx`) — invoice register with a summary panel (total invoiced/received, outstanding, overdue amount+count, unpaid/partial/paid counts).
- **Create** (`create.tsx`) — pick an SO, invoice available (dispatched − invoiced) qty per line, set GST% and payment terms.
- **Detail** (`detail.tsx`) — header, lines, payment history; add payment.

## Database Tables
Owned/written (`apps/api/src/db/schema.ts`):

- **`invoices`** (header). Cols: `code` (INV-NNNN), `invoice_date`, `sales_order_id` (FK, NOT NULL, cascade), `so_code_text`, client snapshot (`client_id` FK, `client_name_text`, `client_code_text`, `client_gst_text`), `subtotal`, `gst_percent` (default 18), `gst_amount`, `grand_total`, `total_paid`, `payment_terms_days` (default 45), `due_date`, `status` (`invoice_status` enum: `unpaid` | `partial` | `paid`, default `unpaid`), `remarks`. All money cols numeric(14,2).
  - Indexes: unique `(company_id, code)`; `(company_id, sales_order_id)`; `(company_id, invoice_date)`; `(company_id, status)`.
- **`invoice_lines`**. Cols: `invoice_id` (FK cascade), `line_no`, `item_id` (FK, set null), `item_code_text`, `item_name` (NOT NULL), `qty` (integer), `rate` (numeric 12,2), `line_amount` (numeric 14,2), `sales_order_line_id` (FK, set null).
  - Indexes: unique `(invoice_id, line_no)`; partial `(sales_order_line_id)`.
- **`invoice_payments`** (one row per receipt). Cols: `invoice_id` (FK cascade), `payment_date`, `amount` (numeric 14,2), `mode` (default `NEFT`), `ref_no`, `notes`.
  - Index: `(invoice_id)`.

All three carry `company_id`, audit cols, `deleted_at`, RLS enabled. Policies: `*_company_read`; `*_manager_write` (admin/manager in-company).

## API Endpoints
`routes.ts` — all require authentication.
- `GET /invoices` — list + rollup summary.
- `GET /invoices/invoiceable/:soId` — per-line available-to-invoice (dispatched − invoiced) for an SO, plus client GST.
- `GET /invoices/:id` — detail (header + lines + payments).
- `POST /invoices` → 201 — create invoice (write role).
- `POST /invoices/:id/payments` → 201 — add a payment (write role).

## Services / Key Functions
`service.ts` (public):
- `listInvoices(user)` → `{ invoices, summary }` — derives balance + overdue per row and aggregates the summary.
- `getInvoiceableSo(soId, user)` → SO + client GST + invoiceable lines.
- `getInvoice(id, user)` → detail.
- `createInvoice(input, user)` → detail. **Transactional**; write role.
- `addPayment(invoiceId, input, user)` → detail. **Transactional**; write role.

Helpers: `loadInvoiceableLines` (raw SQL summing prior `invoice_lines.qty` per SO line), `nextInvoiceCode`, `getInvoiceInternal`, `isOverdue`, `rowToInvoice`.

## Entry Points
- API `invoicesRoutes(app)`.
- Web hooks `apps/web/src/modules/invoices/api.ts`; lib/.

## Business Logic
- **Invoiceable qty:** per SO line `availableQty = max(0, dispatched_qty − Σ invoiced_qty)` (invoiced summed across non-deleted invoices/lines). Create rejects a line not on the SO (`ValidationError`) or `qty > availableQty` (`ConflictError`).
- **Create:** snapshots client (name/code/GST) from the SO's client. `subtotal = Σ qty×rate`; `gst_amount = round(subtotal × gst% / 100, 2)`; `grand_total = subtotal + gst_amount`. `due_date = invoice_date + payment_terms_days`. Allocates `INV-NNNN` (max numeric suffix + 1). Inserts header (`status='unpaid'`, `total_paid=0`) + lines. Emits `CREATE / Invoice`.
- **Payment status machine:** `unpaid` → `partial` → `paid`, driven by cumulative `total_paid` vs `grand_total`:
  - `addPayment` rejects `amount > balance + 0.01` (`ConflictError`). Inserts an `invoice_payments` row, then recomputes `total_paid` and sets status: `paid` if `newPaid ≥ grand − 0.01`, else `partial` if `> 0`, else `unpaid`. Emits `PAYMENT / Invoice`.
- **Overdue** is derived (not stored): `status != 'paid' && due_date < today`. Drives the list summary's overdue amount/count.

## Dependencies on Other Modules
- **Sales Orders** — `sales_orders` / `sales_order_lines` (dispatched qty as the invoicing cap).
- **Clients** — client snapshot (name/code/GST).
- **Customer Dispatches** — upstream: invoiceable qty is bounded by dispatched qty.
- **Activity Log** — `emitActivityLog`.

## User Roles / Access
- Read: any authenticated in-company user (RLS `company_read`).
- Create invoice / add payment: `requireWriteRole` → **admin / manager** (also RLS `manager_write`).

## Reports
- Invoice register with financial summary (total invoiced, total received, outstanding, overdue amount + count, unpaid/partial/paid counts). Feeds Pending SO Value / cashflow.

## Imports / Exports
- No file import/export in this module.

## Background Jobs
None. Overdue is computed on read against the current date.
