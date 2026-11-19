// ADR-310 — SO Invoices' shared Export (copy of the JWSO Master pilot,
// job-work-orders/lib/export-lines.ts).
//
// Sheet 1 "Invoices": the list's own columns as the user sees them. The
// Invoice Status cell is a StatusBadge + an "Overdue" chip, so it gets an
// `exportValue` in plain words; Due Date / money cells already read cleanly.
// Sheet 2 "Invoice Lines": GET /invoices/lines with NO search (a search on an
// item code would drop the invoice's other lines) and NO `sf` — the lines
// endpoint has its own Sort & Filter column map (INVOICE_LINE_SF_COLUMNS) and
// the Invoice Status filter lives inside `sf` on this list. The shared hook's
// doc filter keeps the lines to the invoices on sheet 1.
// No-price user: the money columns (Grand Total · Paid · Outstanding Amount)
// are left off sheet 1, and Rate / Amount are left out of the Lines header
// AND every line row (sheet-print hideMoney rule).

import type { InvoiceListLineRow, InvoiceRow, ListInvoicesQuery } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchInvoiceLinesPage, fetchInvoiceList } from '../api';
import { INVOICE_STATUS_LABEL } from '../components/invoice-list-columns';

/** Money column ids on sheet 1 — also flagged `money: true` on the columns. */
const INVOICE_MONEY_COLUMNS = ['grand_total', 'paid_amount', 'outstanding_amount'];

const MONEY_HEADS = new Set(['Rate', 'Amount']);

const LINE_HEADS = [
  'Invoice No.',
  'Invoice Date',
  'SO No.',
  'Internal SO No.',
  'POL',
  'Item Code',
  'Item Name',
  'Customer',
  'Qty',
  'Rate',
  'Amount',
  'Invoice Status',
  'Due Date',
];

/** Line-sheet headings — docs/NAMING.md names; Rate / Amount gone when hideMoney. */
export function invoiceLinesHeader(hideMoney: boolean): string[] {
  return hideMoney ? LINE_HEADS.filter((h) => !MONEY_HEADS.has(h)) : LINE_HEADS;
}

function statusWord(status: string, overdue: boolean): string {
  const word = INVOICE_STATUS_LABEL[status] ?? status;
  return overdue ? `${word} (Overdue)` : word;
}

/** One Lines-sheet row, in invoiceLinesHeader(hideMoney) order. */
export function invoiceLineExportRow(
  l: InvoiceListLineRow,
  hideMoney: boolean,
): (string | number | null)[] {
  const money = hideMoney ? [] : [l.rate ?? null, l.lineAmount ?? null];
  return [
    l.invoiceCode,
    fmtDate(l.invoiceDate, '') || null,
    l.soCode ?? null,
    l.soInternalNo ?? null,
    l.clientPoLineNo ?? null,
    itemCodeWithRev(l.itemCode, l.itemRevision, '') || null,
    l.itemName || null,
    l.clientName ?? null,
    l.qty,
    ...money,
    statusWord(l.invoiceStatus, l.overdue),
    fmtDate(l.dueDate, '') || null,
  ];
}

/** exportValue for the invoice columns whose shown text is a component. */
export function withInvoiceExportValues(
  columns: DataTableColumn<InvoiceRow>[],
): DataTableColumn<InvoiceRow>[] {
  return columns.map((c) =>
    c.id === 'status'
      ? { ...c, exportValue: (r: InvoiceRow) => statusWord(r.status, Boolean(r.overdue)) }
      : c,
  );
}

export interface InvoiceExportArgs {
  columns: DataTableColumn<InvoiceRow>[];
  tableKey: string;
  search: string | undefined;
  sfParam: string | undefined;
  hideMoney: boolean;
}

export function invoiceExportSpec(
  a: InvoiceExportArgs,
): ListExportSpec<InvoiceRow, InvoiceListLineRow> {
  const words = [
    a.search ? `search "${a.search}"` : null,
    a.sfParam ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  return {
    fileName: 'Invoices',
    tableKey: a.tableKey,
    columns: a.columns,
    rowKey: (r) => r.id,
    hideMoney: a.hideMoney,
    moneyColumns: INVOICE_MONEY_COLUMNS,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: async (limit, offset) => {
      const res = await fetchInvoiceList({ search: a.search, sf: a.sfParam, limit, offset });
      return { items: res.invoices, total: res.total };
    },
    linesSheet: {
      name: 'Invoice Lines',
      header: invoiceLinesHeader(a.hideMoney),
      fetchPage: async (limit, offset) => {
        const q: ListInvoicesQuery = { limit, offset };
        const res = await fetchInvoiceLinesPage(q);
        return { items: res.rows, total: res.total };
      },
      docKey: (r) => r.id,
      lineDocKey: (l) => l.invoiceId,
      toRow: (l) => invoiceLineExportRow(l, a.hideMoney),
    },
  };
}
