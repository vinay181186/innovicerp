// Sort & Filter (ADR-200 / ADR-201) — the SO Invoices list's sortable /
// filterable fields. Each expression is what listInvoices SELECTs for that
// column (the invoices row itself), valid in both its page and count queries.

import { sql } from 'drizzle-orm';

import { invoices } from '../../db/schema';
import type { SfColumnMap } from '../../lib/list-query';

export const INVOICE_SF_COLUMNS: SfColumnMap = {
  code: { sql: sql`${invoices.code}`, type: 'text' },
  invoiceDate: { sql: sql`${invoices.invoiceDate}`, type: 'date' },
  soCode: { sql: sql`${invoices.soCodeText}`, type: 'text' },
  clientName: { sql: sql`${invoices.clientNameText}`, type: 'text' },
  grandTotal: { sql: sql`COALESCE(${invoices.grandTotal}, 0)`, type: 'num', price: true },
  totalPaid: { sql: sql`COALESCE(${invoices.totalPaid}, 0)`, type: 'num', price: true },
  // Outstanding Amount = grand total − paid − TDS (rowToInvoice's balance).
  balance: {
    sql: sql`(COALESCE(${invoices.grandTotal}, 0) - COALESCE(${invoices.totalPaid}, 0) - COALESCE(${invoices.totalTds}, 0))`,
    type: 'num',
    price: true,
  },
  status: { sql: sql`${invoices.status}`, type: 'list' },
  dueDate: { sql: sql`${invoices.dueDate}`, type: 'date' },
};

// ADR-261 — GET /invoices/lines (one row per INVOICE LINE). Every invoice
// field above stays valid (the query reads `public.invoices` unaliased); the
// line fields use il = invoice line, sol = its SO line, iso = the SO.
export const INVOICE_LINE_SF_COLUMNS: SfColumnMap = {
  ...INVOICE_SF_COLUMNS,
  soInternalNo: { sql: sql`iso.internal_so_no`, type: 'text' },
  clientPoLineNo: { sql: sql`sol.client_po_line_no`, type: 'text' },
  createdOn: {
    sql: sql`(COALESCE(il.created_at, ${invoices.createdAt}) AT TIME ZONE 'Asia/Kolkata')::date`,
    type: 'date',
  },
  itemCode: { sql: sql`il.item_code_text`, type: 'text' },
  itemName: { sql: sql`il.item_name`, type: 'text' },
  qty: { sql: sql`il.qty`, type: 'num' },
  lineAmount: { sql: sql`COALESCE(il.line_amount, 0)`, type: 'num', price: true },
};
