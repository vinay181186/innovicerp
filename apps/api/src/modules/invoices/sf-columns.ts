// Sort & Filter (ADR-200 / ADR-201) — the SO Invoices list's sortable /
// filterable fields. Each expression is what listInvoices SELECTs for that
// column (the invoices row itself), valid in both its page and count queries.

import { sql } from 'drizzle-orm';

import { invoices } from '../../db/schema';
import { createdByNameSql } from '../../lib/created-by-sql';
import type { SfColumnMap, SfLiftSpec } from '../../lib/list-query';

/** The invoice's own SO, live code first, the snapshot as the fallback. */
const invoiceSoCodeSql = sql`COALESCE(
  (SELECT iso_h.code FROM public.sales_orders iso_h WHERE iso_h.id = ${invoices.salesOrderId}),
  ${invoices.soCodeText})`;

/** The Internal SO No. of the invoice's own SO (ADR-207). */
const INVOICE_SO_INTERNAL_NO_SQL = sql`(SELECT iso_i.internal_so_no FROM public.sales_orders iso_i
  WHERE iso_i.id = ${invoices.salesOrderId})`;

export const INVOICE_SF_COLUMNS: SfColumnMap = {
  code: { sql: sql`${invoices.code}`, type: 'text' },
  invoiceDate: { sql: sql`${invoices.invoiceDate}`, type: 'date' },
  // Sort reads the invoice's own SO; a FILTER on soCode / soInternalNo goes
  // through INVOICE_LINE_LIFT (header OR any line) instead — see below.
  soCode: { sql: invoiceSoCodeSql, type: 'text' },
  // ADR-303 — one row per INVOICE again: Internal SO No., Created On / By, Lines.
  soInternalNo: { sql: INVOICE_SO_INTERNAL_NO_SQL, type: 'text' },
  createdOn: {
    sql: sql`(${invoices.createdAt} AT TIME ZONE 'Asia/Kolkata')::date`,
    type: 'date',
  },
  createdBy: { sql: createdByNameSql(invoices.createdBy), type: 'text' },
  lineCount: {
    sql: sql`(SELECT COUNT(*)::int FROM public.invoice_lines il_c
              WHERE il_c.invoice_id = ${invoices.id} AND il_c.deleted_at IS NULL)`,
    type: 'num',
  },
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
  // ADR-267 — the live SO first, the snapshot as the fallback (`iso` is in the ONE
  // FROM of list-lines.ts: page, count and summary).
  soCode: { sql: sql`COALESCE(iso.code, ${invoices.soCodeText})`, type: 'text' },
  soInternalNo: { sql: sql`iso.internal_so_no`, type: 'text' },
  clientPoLineNo: { sql: sql`sol.client_po_line_no`, type: 'text' },
  createdOn: {
    sql: sql`(COALESCE(il.created_at, ${invoices.createdAt}) AT TIME ZONE 'Asia/Kolkata')::date`,
    type: 'date',
  },
  createdBy: {
    sql: createdByNameSql(sql`COALESCE(il.created_by, ${invoices.createdBy})`),
    type: 'text',
  },
  itemCode: { sql: sql`il.item_code_text`, type: 'text' },
  itemName: { sql: sql`il.item_name`, type: 'text' },
  qty: { sql: sql`il.qty`, type: 'num' },
  lineAmount: { sql: sql`COALESCE(il.line_amount, 0)`, type: 'num', price: true },
};

/**
 * ADR-303 / ADR-267 — SO No. / Internal SO No. filters (the SO dropdown too) on
 * the per-INVOICE list: judged over the invoice's own SO AND the SO of every
 * live line (lib/list-query liftLineFilters), so each invoice stays one row.
 */
export const INVOICE_LINE_LIFT: SfLiftSpec = {
  fields: {
    soCode: { header: invoiceSoCodeSql, line: sql`so_s.code`, type: 'text' },
    soInternalNo: {
      header: INVOICE_SO_INTERNAL_NO_SQL,
      line: sql`so_s.internal_so_no`,
      type: 'text',
    },
  },
  linesFrom: sql`FROM public.invoice_lines il_s
    JOIN public.sales_order_lines sol_s ON sol_s.id = il_s.sales_order_line_id
    JOIN public.sales_orders so_s ON so_s.id = sol_s.sales_order_id
    WHERE il_s.invoice_id = ${invoices.id} AND il_s.deleted_at IS NULL`,
};
