// SO Invoices list columns (moved out of routes/list.tsx to keep it < 400).
// ADR-201: sortFilterField = the server column map (api invoices/sf-columns.ts).

import type { ListInvoicesResponse } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fmtDate } from '@/lib/date';
import { soNoWithInternal } from '@/lib/so-number';
import { StatusBadge } from '@/ui/core';
import type { DataTableColumn } from '@/ui/data';

export type InvoiceListRow = ListInvoicesResponse['invoices'][number];

const inr = (v: number): string => `₹${Math.round(v).toLocaleString('en-IN')}`;

/** Invoice status → the words the user reads; the stored codes are unchanged. */
const INVOICE_STATUS_LABEL: Record<string, string> = {
  unpaid: 'Unpaid',
  partial: 'Partly Paid',
  paid: 'Paid',
};
const INVOICE_STATUS_OPTIONS = Object.entries(INVOICE_STATUS_LABEL).map(([value, label]) => ({
  value,
  label,
}));

export function invoiceListColumns(priceHidden: boolean): DataTableColumn<InvoiceListRow>[] {
  // Widths sum to 90 — DataTable's Action column takes the remaining 10.
  const moneyColumns: DataTableColumn<InvoiceListRow>[] = priceHidden
    ? []
    : [
        {
          id: 'grand_total',
          header: 'Grand Total',
          kind: 'num',
          sortFilterField: 'grandTotal',
          width: '9%',
          align: 'right',
          className: 'mono fw-700',
          nowrap: true,
          render: (inv) => (
            <span style={{ color: 'var(--green2)' }}>{inr(inv.grandTotal ?? 0)}</span>
          ),
        },
        {
          id: 'paid_amount',
          header: 'Paid',
          kind: 'num',
          sortFilterField: 'totalPaid',
          width: '8%',
          align: 'right',
          className: 'mono fw-700',
          nowrap: true,
          render: (inv) => <span style={{ color: 'var(--cyan)' }}>{inr(inv.totalPaid ?? 0)}</span>,
        },
        {
          id: 'outstanding_amount',
          header: 'Outstanding Amount',
          kind: 'num',
          sortFilterField: 'balance',
          width: '9%',
          align: 'right',
          className: 'mono fw-700',
          nowrap: true,
          render: (inv) => (
            <span style={{ color: (inv.balance ?? 0) > 0 ? 'var(--red)' : 'var(--green)' }}>
              {inr(inv.balance ?? 0)}
            </span>
          ),
        },
      ];

  const columns: DataTableColumn<InvoiceListRow>[] = [
    {
      id: 'code',
      header: 'Invoice No.',
      sortFilterField: 'code',
      width: priceHidden ? '15%' : '12%',
      className: 'td-code',
      nowrap: true,
      // Kept a real <Link> (not plain text): the code is how this list is
      // ctrl-clicked / middle-clicked open in a new tab today.
      render: (inv) => (
        <Link
          to="/invoices/$id"
          params={{ id: inv.id }}
          style={{ color: 'inherit', textDecoration: 'none' }}
        >
          {inv.code}
        </Link>
      ),
    },
    {
      id: 'invoice_date',
      kind: 'date',
      sortFilterField: 'invoiceDate',
      header: 'Invoice Date',
      width: priceHidden ? '11%' : '8%',
      nowrap: true,
      render: (inv) => fmtDate(inv.invoiceDate),
    },
    {
      id: 'so_code',
      header: 'SO No.',
      sortFilterField: 'soCode',
      width: priceHidden ? '12%' : '9%',
      className: 'td-code',
      nowrap: true,
      render: (inv) => (inv.soCode ? soNoWithInternal(inv.soCode, inv.soInternalNo) : '—'),
    },
    {
      id: 'customer',
      header: 'Customer',
      sortFilterField: 'clientName',
      width: priceHidden ? '31%' : '17%',
      align: 'left',
      className: 'fw-700',
      ellipsis: true,
      key: 'clientName',
    },
    ...moneyColumns,
    {
      id: 'status',
      kind: 'badge',
      sortFilterField: 'status',
      filterOptions: INVOICE_STATUS_OPTIONS,
      header: 'Invoice Status',
      width: priceHidden ? '13%' : '11%',
      nowrap: true,
      render: (inv) => (
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
            status={inv.status}
            label={INVOICE_STATUS_LABEL[inv.status] ?? inv.status}
          />
          {inv.overdue ? <span className="badge b-red">Overdue</span> : null}
        </span>
      ),
    },
    {
      id: 'due_date',
      kind: 'date',
      sortFilterField: 'dueDate',
      header: 'Due Date',
      width: priceHidden ? '8%' : '7%',
      nowrap: true,
      render: (inv) => (
        <span style={{ color: inv.overdue ? 'var(--red)' : 'var(--text3)' }}>
          {fmtDate(inv.dueDate)}
        </span>
      ),
    },
  ];
  return columns;
}
