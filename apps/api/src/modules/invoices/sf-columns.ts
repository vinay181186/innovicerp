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
