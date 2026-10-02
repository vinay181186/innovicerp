// Sort & Filter (ADR-200) — the JW Invoice register's sortable / filterable
// fields. listJwInvoices reads jw_invoices LEFT JOIN clients, job_work_order_lines
// and items; its list AND count queries carry the same joins, so each
// expression is the one the row shows (Item Code as itemCodeWithRev prints it:
// the live item code, else the JWSO line's snapshot, then "/rev").
//   taxable / total — money: only for users who may see JW prices.

import { sql } from 'drizzle-orm';

import { clients, items, jobWorkOrderLines, jwInvoices } from '../../db/schema';
import type { SfColumnMap } from '../../lib/list-query';

export const JW_INVOICE_SF_COLUMNS: SfColumnMap = {
  invoiceCode: { sql: sql`${jwInvoices.code}`, type: 'text' },
  invoiceDate: { sql: sql`${jwInvoices.invoiceDate}`, type: 'date' },
  jwsoCode: { sql: sql`${jwInvoices.jwCodeText}`, type: 'text' },
  customer: { sql: sql`${clients.name}`, type: 'text' },
  itemCode: {
    sql: sql`(COALESCE(${items.code}, ${jobWorkOrderLines.itemCodeText}) || COALESCE('/' || NULLIF(btrim(${jobWorkOrderLines.revision}::text), ''), ''))`,
    type: 'text',
  },
  qty: { sql: sql`${jwInvoices.qty}`, type: 'num' },
  taxable: { sql: sql`${jwInvoices.taxableAmount}`, type: 'num', price: true },
  total: { sql: sql`${jwInvoices.totalAmount}`, type: 'num', price: true },
  status: { sql: sql`${jwInvoices.status}`, type: 'list' },
};
