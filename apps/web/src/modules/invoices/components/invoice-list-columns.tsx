// SO Invoices list columns (moved out of routes/list.tsx to keep it < 400).
// ADR-201: sortFilterField = the server column map (api invoices/sf-columns.ts).
// ADR-303 (owner 2026-11-16): ONE ROW PER INVOICE again (GET /invoices). The
// locked lead block first (Sr No · Invoice No. · Created On · SO No. ·
// Internal SO No.; no POL / Item Code / Item Name — an invoice has many lines),
// then Invoice Date, Customer, Lines, Grand Total · Paid · Outstanding Amount
// (price-gated), Invoice Status, Due Date and Created By. Labels per
// docs/NAMING.md (bare "Outstanding" is banned there). The ⋯ acts on the invoice.

import type { InvoiceRow } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fmtDate } from '@/lib/date';
import { StatusBadge } from '@/ui/core';
import { createdByColumn, type DataTableColumn, leadColumns } from '@/ui/data';

export type InvoiceListRow = InvoiceRow;

const inr = (v: number): string => `₹${Math.round(v).toLocaleString('en-IN')}`;

/** Invoice status → the words the user reads; the stored codes are unchanged. */
const INVOICE_STATUS_LABEL: Record<string, string> = {
  unpaid: 'Unpaid',
  partial: 'Partly Paid',
  paid: 'Paid',
  // ADR-202 Phase 3 — a reason-logged cancel replaces editing a statutory doc.
  cancelled: 'Cancelled',
};
/** Invoice counts per status, shown in the Invoice Status ▾ tick list as
 *  "Unpaid (3)" (owner 2026-11-03: no tile row above a list). */
export type InvoiceStatusCounts = Partial<Record<string, number>>;

function statusOptions(
  counts: InvoiceStatusCounts | undefined,
): { value: string; label: string }[] {
  return Object.entries(INVOICE_STATUS_LABEL).map(([value, label]) => {
    const n = counts?.[value];
    return { value, label: n === undefined ? label : `${label} (${n})` };
  });
}

export function invoiceListColumns(
  firstRowNo: number,
  priceHidden: boolean,
  statusCounts?: InvoiceStatusCounts,
): DataTableColumn<InvoiceListRow>[] {
  const moneyColumns: DataTableColumn<InvoiceListRow>[] = priceHidden
    ? []
    : [
        {
          id: 'grand_total',
          header: 'Grand Total',
          kind: 'num',
          money: true,
          sortFilterField: 'grandTotal',
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
          money: true,
          sortFilterField: 'totalPaid',
          className: 'mono fw-700',
          nowrap: true,
          render: (inv) => <span style={{ color: 'var(--cyan)' }}>{inr(inv.totalPaid ?? 0)}</span>,
        },
        {
          id: 'outstanding_amount',
          header: 'Outstanding Amount',
          kind: 'num',
          money: true,
          sortFilterField: 'balance',
          className: 'mono fw-700',
          nowrap: true,
          render: (inv) => (
            <span style={{ color: (inv.balance ?? 0) > 0 ? 'var(--red)' : 'var(--green)' }}>
              {inr(inv.balance ?? 0)}
            </span>
          ),
        },
      ];

  return [
    ...leadColumns<InvoiceListRow>({
      firstRowNo,
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
            params={{ id: r.id }}
            style={{ color: 'inherit', textDecoration: 'none' }}
            onClick={(e) => e.stopPropagation()}
          >
            {r.code}
          </Link>
        ),
      },
      soNo: (r) => r.soCode,
      createdOn: (r) => r.createdAt,
      overrides: {
        so_no: {
          sortFilterField: 'soCode',
          // ADR-303 — lines from more than one SO: the first SO No. + grey "+n".
          render: (r) => (
            <span style={{ whiteSpace: 'nowrap' }}>
              <span style={{ color: 'var(--blue)' }}>{r.soCode?.trim() || '—'}</span>
              {(r.extraSoCount ?? 0) > 0 ? (
                <span className="text3" title="Lines from other SOs too">
                  {' '}
                  +{r.extraSoCount}
                </span>
              ) : null}
            </span>
          ),
        },
        created_on: { sortFilterField: 'createdOn' },
      },
    }),
    {
      id: 'invoice_date',
      kind: 'date',
      sortFilterField: 'invoiceDate',
      header: 'Invoice Date',
      nowrap: true,
      render: (r) => fmtDate(r.invoiceDate),
    },
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
      id: 'line_count',
      header: 'Lines',
      kind: 'num',
      sortFilterField: 'lineCount',
      filterType: 'num',
      className: 'mono',
      nowrap: true,
      render: (r) => r.lineCount ?? 0,
    },
    ...moneyColumns,
    {
      id: 'status',
      kind: 'badge',
      sortFilterField: 'status',
      filterOptions: statusOptions(statusCounts),
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
            status={r.status}
            label={INVOICE_STATUS_LABEL[r.status] ?? r.status}
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
    // ADR-261 rev — Created By, the last data column (the invoice's creator).
    createdByColumn({
      createdByName: (r) => r.createdByName,
      overrides: { sortFilterField: 'createdBy' },
    }),
  ];
}
