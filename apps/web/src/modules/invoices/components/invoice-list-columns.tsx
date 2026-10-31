// SO Invoices list columns (moved out of routes/list.tsx to keep it < 400).
// ADR-201: sortFilterField = the server column map (api invoices/sf-columns.ts).
// ADR-261 (owner 2026-10-31): ONE ROW PER INVOICE LINE (GET /invoices/lines).
// Invoice No. and the six lead columns come first (SO No. · Internal SO No. ·
// POL · Created On · Item Code (CODE/REV) · Item Name), then Invoice Date,
// Customer, the line's Invoice Qty and Amount (price-gated), Invoice Status, Due
// Date. Row click and ⋯ act on the INVOICE.

import type { InvoiceListLineRow } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fmtDate } from '@/lib/date';
import { StatusBadge } from '@/ui/core';
import { leadColumns, type DataTableColumn } from '@/ui/data';

export type InvoiceListRow = InvoiceListLineRow;

const inr = (v: number): string => `₹${Math.round(v).toLocaleString('en-IN')}`;

/** Invoice status → the words the user reads; the stored codes are unchanged. */
const INVOICE_STATUS_LABEL: Record<string, string> = {
  unpaid: 'Unpaid',
  partial: 'Partly Paid',
  paid: 'Paid',
  // ADR-202 Phase 3 — a reason-logged cancel replaces editing a statutory doc.
  cancelled: 'Cancelled',
};
const INVOICE_STATUS_OPTIONS = Object.entries(INVOICE_STATUS_LABEL).map(([value, label]) => ({
  value,
  label,
}));

export function invoiceListColumns(priceHidden: boolean): DataTableColumn<InvoiceListRow>[] {
  const moneyColumns: DataTableColumn<InvoiceListRow>[] = priceHidden
    ? []
    : [
        {
          id: 'line_amount',
          header: 'Amount',
          kind: 'num',
          sortFilterField: 'lineAmount',
          align: 'right',
          className: 'mono fw-700',
          nowrap: true,
          render: (r) => <span style={{ color: 'var(--green2)' }}>{inr(r.lineAmount ?? 0)}</span>,
        },
      ];

  return [
    ...leadColumns<InvoiceListRow>({
      doc: {
        id: 'code',
        header: 'Invoice No.',
        sortFilterField: 'code',
        className: 'td-code',
        nowrap: true,
        // Kept a real <Link> (not plain text): the code is how this list is
        // ctrl-clicked / middle-clicked open in a new tab today.
        render: (r) => (
          <Link
            to="/invoices/$id"
            params={{ id: r.invoiceId }}
            style={{ color: 'inherit', textDecoration: 'none' }}
            onClick={(e) => e.stopPropagation()}
          >
            {r.invoiceCode}
          </Link>
        ),
      },
      docDate: {
        id: 'invoice_date',
        kind: 'date',
        sortFilterField: 'invoiceDate',
        header: 'Invoice Date',
        nowrap: true,
        render: (r) => fmtDate(r.invoiceDate),
      },
      soNo: (r) => r.soCode,
      internalSoNo: (r) => r.soInternalNo,
      pol: (r) => r.clientPoLineNo,
      createdOn: (r) => r.createdAt,
      itemCode: (r) => r.itemCode,
      itemRev: (r) => r.itemRevision,
      itemName: (r) => r.itemName,
      overrides: {
        so_no: { sortFilterField: 'soCode' },
        so_internal_no: { sortFilterField: 'soInternalNo' },
        client_po_line_no: { sortFilterField: 'clientPoLineNo' },
        created_on: { sortFilterField: 'createdOn' },
        item_code: { sortFilterField: 'itemCode' },
        item_name: { sortFilterField: 'itemName' },
      },
    }),
    {
      id: 'customer',
      header: 'Customer',
      sortFilterField: 'clientName',
      align: 'left',
      className: 'fw-700',
      ellipsis: true,
      render: (r) => r.clientName ?? '—',
      title: (r) => r.clientName ?? '',
    },
    {
      id: 'qty',
      header: 'Invoice Qty',
      kind: 'num',
      sortFilterField: 'qty',
      align: 'right',
      className: 'mono fw-700',
      nowrap: true,
      render: (r) => r.qty,
    },
    ...moneyColumns,
    {
      id: 'status',
      kind: 'badge',
      sortFilterField: 'status',
      filterOptions: INVOICE_STATUS_OPTIONS,
      header: 'Invoice Status',
      nowrap: true,
      render: (r) => (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--sp-1)',
            whiteSpace: 'nowrap',
          }}
        >
          {/* kind="invoice", not "doc": the generic map paints unpaid amber and
            partial blue, which disagreed with the detail page's own colours
            for the SAME invoice. One status, one colour, both screens. */}
          <StatusBadge
            kind="invoice"
            status={r.invoiceStatus}
            label={INVOICE_STATUS_LABEL[r.invoiceStatus] ?? r.invoiceStatus}
          />
          {r.overdue ? <span className="badge b-red">Overdue</span> : null}
        </span>
      ),
    },
    {
      id: 'due_date',
      kind: 'date',
      sortFilterField: 'dueDate',
      header: 'Due Date',
      nowrap: true,
      render: (r) => (
        <span style={{ color: r.overdue ? 'var(--red)' : 'var(--text3)' }}>
          {fmtDate(r.dueDate)}
        </span>
      ),
    },
  ];
}
