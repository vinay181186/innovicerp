// JWSO Master list columns (ADR-199 fit table: one line per JWSO). Split out of
// routes/list.tsx so that file stays under the 400-line ceiling. Centred by the
// table standard; numbers right-aligned (align 'right' -> the num kind); only
// the Customer name is left-aligned and shares the spare width.
//
// Columns (first pinned): JWSO No. · JWSO Date · Customer · Client PO No. ·
// Order Qty · JC Qty · Dispatched · Pending · Customer Material · Due ·
// JWSO Status. Every field was already shown by the retired card — nothing new.

import type { JobWorkOrderListItem } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fmtDate } from '@/lib/date';
import type { DataTableColumn } from '@/ui/data';
import { SoStatusBadge } from '@/modules/sales-orders/components/so-status-badge';
import { SO_STATUS_LABEL } from '@/modules/sales-orders/lib/so-status-label';

// Sort & Filter (server mode): the JWSO status tick list — stored code + label.
const STATUS_OPTIONS = Object.entries(SO_STATUS_LABEL).map(([value, label]) => ({
  value,
  label,
}));

/** Customer-material status as coloured text: customer RM QC-accepted across
 *  the lines (`partyReceivedQty`) vs what the lines need (`rmRequiredQty` —
 *  1 RM piece per finished part on lines that have a Customer RM, ADR-203). */
function MaterialCell({
  received,
  expected,
}: {
  received: number;
  expected: number;
}): React.JSX.Element {
  if (expected > 0 && received >= expected) {
    return <span style={{ color: 'var(--green2)', fontWeight: 700 }}>✓ Full</span>;
  }
  if (received > 0) {
    return (
      <span style={{ color: 'var(--amber2)', fontWeight: 700 }}>
        ◑ Partly Received ({received})
      </span>
    );
  }
  return <span style={{ color: 'var(--red2)', fontWeight: 700 }}>✕ Not Received</span>;
}

/** `today` (IST) drives the overdue colour on the Due column — a JWSO still open
 *  past its earliest due date is late. */
export function jwsoListColumns(today: string): DataTableColumn<JobWorkOrderListItem>[] {
  return [
    {
      // First column — pinned by the table standard (ADR-199).
      id: 'jwso_code',
      sortFilterField: 'code',
      header: 'JWSO No.',
      nowrap: true,
      render: (jw) => (
        <Link
          to="/job-work-orders/$id"
          params={{ id: jw.jwId }}
          className="td-code"
          style={{ color: 'var(--blue)', fontWeight: 800 }}
          title="Open the JWSO detail page"
          onClick={(e) => e.stopPropagation()}
        >
          {jw.code}
        </Link>
      ),
    },
    {
      id: 'jwso_date',
      sortFilterField: 'jwDate',
      kind: 'date',
      header: 'JWSO Date',
      className: 'mono',
      nowrap: true,
      render: (jw) => fmtDate(jw.jwDate),
    },
    {
      id: 'customer',
      sortFilterField: 'customerName',
      header: 'Customer',
      align: 'left',
      ellipsis: true,
      className: 'fw-700',
      render: (jw) => jw.customerName ?? '—',
      title: (jw) => jw.customerName ?? '',
    },
    {
      id: 'client_po',
      sortFilterField: 'clientPoNo',
      header: 'Client PO No.',
      headColor: 'var(--purple)',
      nowrap: true,
      render: (jw) =>
        jw.clientPoNo ? (
          <span className="mono fw-700" style={{ color: 'var(--purple)' }}>
            {jw.clientPoNo}
          </span>
        ) : (
          <span className="text3">—</span>
        ),
    },
    {
      id: 'order_qty',
      sortFilterField: 'totalQty',
      filterType: 'num',
      header: 'Order Qty',
      align: 'right',
      nowrap: true,
      className: 'mono fw-700',
      render: (jw) => jw.totalQty,
    },
    {
      id: 'jc_qty',
      sortFilterField: 'jcQty',
      filterType: 'num',
      header: 'JC Qty',
      align: 'right',
      nowrap: true,
      render: (jw) => (
        <span
          className="mono fw-700"
          style={{
            color:
              jw.jcQty >= jw.totalQty && jw.totalQty > 0
                ? 'var(--green)'
                : jw.jcQty > 0
                  ? 'var(--amber)'
                  : 'var(--text3)',
          }}
        >
          {jw.jcQty}
        </span>
      ),
    },
    {
      id: 'dispatched',
      sortFilterField: 'dispatchedQty',
      filterType: 'num',
      header: 'Dispatched',
      headColor: 'var(--green)',
      align: 'right',
      nowrap: true,
      render: (jw) => (
        <span
          className="mono fw-700"
          style={{ color: jw.dispatchedQty > 0 ? 'var(--green)' : 'var(--text3)' }}
        >
          {jw.dispatchedQty}
        </span>
      ),
    },
    {
      id: 'pending',
      sortFilterField: 'pendingQty',
      filterType: 'num',
      header: 'Pending',
      headColor: 'var(--red)',
      align: 'right',
      nowrap: true,
      render: (jw) => {
        const pending = Math.max(0, jw.totalQty - jw.dispatchedQty);
        return (
          <span
            className="mono fw-700"
            style={{ color: pending > 0 ? 'var(--red)' : 'var(--green)' }}
          >
            {pending}
          </span>
        );
      },
    },
    {
      id: 'customer_material',
      header: 'Customer Material',
      nowrap: true,
      render: (jw) => <MaterialCell received={jw.partyReceivedQty} expected={jw.rmRequiredQty} />,
    },
    {
      id: 'due',
      sortFilterField: 'earliestDueDate',
      kind: 'date',
      header: 'Due',
      nowrap: true,
      render: (jw) => {
        const overdue =
          jw.earliestDueDate != null && jw.earliestDueDate < today && jw.status === 'open';
        if (!jw.earliestDueDate) return <span className="text3">—</span>;
        return (
          <span
            className="mono"
            style={{
              color: overdue ? 'var(--red)' : undefined,
              fontWeight: overdue ? 700 : undefined,
            }}
          >
            {fmtDate(jw.earliestDueDate)}
            {overdue ? ' ⚠' : ''}
          </span>
        );
      },
    },
    {
      id: 'jwso_status',
      sortFilterField: 'status',
      filterOptions: STATUS_OPTIONS,
      kind: 'badge',
      header: 'JWSO Status',
      nowrap: true,
      render: (jw) => <SoStatusBadge status={jw.status} />,
    },
  ];
}
