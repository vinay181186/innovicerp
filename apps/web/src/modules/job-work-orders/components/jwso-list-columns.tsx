// JWSO Master list columns (ADR-199 fit table). ADR-303 (owner 2026-11-16):
// ONE ROW PER JWSO again (GET /job-work-orders), opening with the locked lead
// block (leadColumns, so:'jwso' — Sr No · JWSO No. · Created On; no Internal SO
// No. on a JWSO-only list, no POL / Item Code / Item Name: a JWSO has many).
// Then: JWSO Date · Customer · Client PO No. · Lines · Order Qty · JC Qty ·
// Dispatched · Pending · Customer Material · Due Date · JWSO Status · Created By
// — the JWSO's sums over its lines.

import type { JobWorkOrderListItem } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { createdByColumn, type DataTableColumn, leadColumns } from '@/ui/data';
import { SoStatusBadge } from '@/modules/sales-orders/components/so-status-badge';
import { SO_STATUS_LABEL } from '@/modules/sales-orders/lib/so-status-label';
import { CustomerRmStatus } from './customer-rm-status';

// Sort & Filter (server mode): the JWSO status tick list — stored code + label.
const STATUS_OPTIONS = Object.entries(SO_STATUS_LABEL).map(([value, label]) => ({
  value,
  label,
}));

/** An open JWSO past its earliest line due date is late. */
export function jwOverdue(jw: JobWorkOrderListItem, today: string): boolean {
  return jw.earliestDueDate != null && jw.earliestDueDate < today && jw.status === 'open';
}

/** Pieces still owed on the JWSO (NAMING.md "Pending"): the server's per-line
 *  sum — 0 for a line closed short (ADR-196) or cancelled, never below zero. */
export function jwPendingQty(jw: JobWorkOrderListItem): number {
  return jw.pendingQty ?? Math.max(0, jw.totalQty - jw.dispatchedQty);
}

/** `today` (IST) drives the overdue colour on the Due Date column. */
export function jwsoListColumns(
  /** Sr No of the page's first row (offset + 1) — ADR-261 rev. */
  firstRowNo: number,
  today: string,
  /** ADR-202 — JWSO ids with a pending edit; their status cell shows "Draft". */
  draftIds?: Set<string>,
): DataTableColumn<JobWorkOrderListItem>[] {
  return [
    ...leadColumns<JobWorkOrderListItem>({
      firstRowNo,
      so: 'jwso',
      soNo: (r) => r.code,
      createdOn: (r) => r.createdAt,
      overrides: {
        so_no: { sortFilterField: 'code' },
        created_on: { sortFilterField: 'createdOn' },
      },
    }),
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
      id: 'line_count',
      sortFilterField: 'lineCount',
      filterType: 'num',
      kind: 'num',
      header: 'Lines',
      className: 'mono',
      nowrap: true,
      render: (jw) => jw.lineCount,
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
        const pending = jwPendingQty(jw);
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
      header: 'Due Date',
      nowrap: true,
      render: (jw) => {
        const overdue = jwOverdue(jw, today);
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
      // ADR-235 — a cancelled JWSO names its reason on hover.
      render: (jw) => (
        <span
          title={
            jw.status === 'cancelled' && jw.cancelReason
              ? `Cancelled: ${jw.cancelReason}`
              : undefined
          }
        >
          <SoStatusBadge status={jw.status} draft={draftIds?.has(jw.jwId)} />
        </span>
      ),
    },
    // ADR-261 rev — Created By, the last data column (the JWSO's creator).
    createdByColumn({
      createdByName: (r) => r.createdByName,
      overrides: { sortFilterField: 'createdBy' },
    }),
  ];
}
