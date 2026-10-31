// JWSO Master list columns (ADR-199 fit table). ADR-261 (owner 2026-10-31):
// ONE ROW PER JWSO LINE, opening with the locked lead block (leadColumns,
// so:'jwso' — JWSO No. · POL · Created On · Item Code/Rev · Item Name; no
// Internal SO No. on a JWSO-only list). Then: JWSO Date · Customer · Client PO
// No. · Order Qty · JC Qty · Dispatched · Pending · Customer Material · Due ·
// JWSO Status — the line's own figures, the JWSO's header facts.

import type { JobWorkOrderLineListRow } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { type DataTableColumn, leadColumns } from '@/ui/data';
import { SoStatusBadge } from '@/modules/sales-orders/components/so-status-badge';
import { SO_STATUS_LABEL } from '@/modules/sales-orders/lib/so-status-label';
import { CustomerRmStatus } from './customer-rm-status';

// Sort & Filter (server mode): the JWSO status tick list — stored code + label.
const STATUS_OPTIONS = Object.entries(SO_STATUS_LABEL).map(([value, label]) => ({
  value,
  label,
}));

/** A line still open (on an open JWSO) past its own due date is late. */
export function jwLineOverdue(jw: JobWorkOrderLineListRow, today: string): boolean {
  return (
    jw.dueDate != null && jw.dueDate < today && jw.lineStatus === 'open' && jw.docStatus === 'open'
  );
}

/** Pieces still owed on the LINE (NAMING.md "Pending"): ordered − dispatched;
 *  nothing once the line is closed short (ADR-196) or cancelled — the same rule
 *  as soLinePendingQty and the server's pendingQty Sort & Filter column. */
export function jwLinePendingQty(jw: JobWorkOrderLineListRow): number {
  if (jw.lineShortClosedAt || jw.lineStatus === 'cancelled') return 0;
  return Math.max(0, jw.orderQty - jw.dispatchedQty);
}

/** `today` (IST) drives the overdue colour on the Due column — a JWSO line still open
 *  past its own due date is late. */
export function jwsoListColumns(
  today: string,
  /** ADR-202 — JWSO ids with a pending edit; their status cell shows "Draft". */
  draftIds?: Set<string>,
): DataTableColumn<JobWorkOrderLineListRow>[] {
  return [
    ...leadColumns<JobWorkOrderLineListRow>({
      so: 'jwso',
      soNo: (r) => r.docCode,
      pol: (r) => r.clientPoLineNo,
      createdOn: (r) => r.createdAt,
      itemCode: (r) => r.itemCode,
      itemRev: (r) => r.itemRevision,
      itemName: (r) => r.itemName,
      overrides: {
        so_no: { sortFilterField: 'code' },
        client_po_line_no: { sortFilterField: 'clientPoLineNo' },
        created_on: { sortFilterField: 'createdOn' },
        item_code: { sortFilterField: 'itemCode' },
        item_name: { sortFilterField: 'itemName' },
      },
    }),
    {
      id: 'jwso_date',
      sortFilterField: 'jwDate',
      kind: 'date',
      header: 'JWSO Date',
      className: 'mono',
      nowrap: true,
      render: (jw) => fmtDate(jw.docDate),
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
      render: (jw) => jw.orderQty,
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
              jw.jcQty >= jw.orderQty && jw.orderQty > 0
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
        const pending = jwLinePendingQty(jw);
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
      render: (jw) => <CustomerRmStatus value={jw.customerRm} />,
    },
    {
      id: 'due',
      sortFilterField: 'earliestDueDate',
      kind: 'date',
      header: 'Due',
      nowrap: true,
      render: (jw) => {
        const overdue = jwLineOverdue(jw, today);
        if (!jw.dueDate) return <span className="text3">—</span>;
        return (
          <span
            className="mono"
            style={{
              color: overdue ? 'var(--red)' : undefined,
              fontWeight: overdue ? 700 : undefined,
            }}
          >
            {fmtDate(jw.dueDate)}
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
      // ADR-235 — a cancelled JWSO names its reason on hover.
      render: (jw) => (
        <span
          title={
            jw.docStatus === 'cancelled' && jw.cancelReason
              ? `Cancelled: ${jw.cancelReason}`
              : undefined
          }
        >
          <SoStatusBadge status={jw.docStatus} draft={draftIds?.has(jw.docId)} />
        </span>
      ),
    },
  ];
}
