// Purchase Order list columns (ADR-199 fit table: one line per PO). Moved out
// of routes/list.tsx so that file stays under the 400-line ceiling. Centred by
// the table standard; numbers right-aligned (align 'right' -> the num kind);
// only the Vendor name is left-aligned and shares the spare width.
//
// Every column reads a field the retired card / sheet already showed — except
// nothing new: PO No., PO Date, PO Type, Vendor, PR No., Qty, Received,
// Accepted, Pending, Value, PO Status. Value keeps its price gate: the API nulls
// `totalAmount` when the viewer may not see prices, and that null renders "—".

import type { PurchaseOrderListItem } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fmtDate } from '@/lib/date';
import { Badge } from '@/ui/core';
import type { DataTableColumn } from '@/ui/data';
import { PO_STATUS_LABELS, PO_TYPE_LABELS } from '../lib/po-labels';
import { PoStatusBadge } from './po-status-badge';

// Whole rupees, Indian grouping — the same shape the Invoices list uses.
const inr = (v: number): string => `₹${Math.round(v).toLocaleString('en-IN')}`;

/** Sort & Filter tick lists (server mode): stored code → the label shown. */
const toOptions = (labels: Record<string, string>): Array<{ value: string; label: string }> =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));
const PO_STATUS_OPTIONS = toOptions(PO_STATUS_LABELS);
const PO_TYPE_OPTIONS = toOptions(PO_TYPE_LABELS);

/** `canSeePrice` — Value is sortable / filterable only for a user who may see
 *  PO prices (the API refuses it otherwise; ADR-200). */
export function purchaseOrderListColumns({
  canSeePrice,
}: {
  canSeePrice: boolean;
}): DataTableColumn<PurchaseOrderListItem>[] {
  return [
    {
      // First column — pinned by the table standard (ADR-199).
      id: 'po_code',
      sortFilterField: 'poCode',
      header: 'PO No.',
      nowrap: true,
      render: (po) => (
        <Link
          to="/purchase-orders/$id"
          params={{ id: po.id }}
          className="td-code"
          style={{ color: 'var(--blue)', fontWeight: 800 }}
          title="Open the PO detail page"
          onClick={(e) => e.stopPropagation()}
        >
          {po.code}
        </Link>
      ),
    },
    {
      id: 'po_date',
      sortFilterField: 'poDate',
      kind: 'date',
      header: 'PO Date',
      className: 'mono',
      nowrap: true,
      render: (po) => fmtDate(po.poDate),
    },
    {
      id: 'po_type',
      sortFilterField: 'poType',
      filterType: 'list',
      filterOptions: PO_TYPE_OPTIONS,
      header: 'PO Type',
      nowrap: true,
      // Same chip the card showed — amber Job Work, teal Service, blue
      // Standard / Outsource.
      render: (po) => (
        <Badge
          tone={po.poType === 'job_work' ? 'amber' : po.poType === 'service' ? 'teal' : 'blue'}
        >
          {PO_TYPE_LABELS[po.poType]}
        </Badge>
      ),
    },
    {
      id: 'vendor',
      sortFilterField: 'vendorName',
      header: 'Vendor',
      align: 'left',
      ellipsis: true,
      className: 'fw-700',
      render: (po) => po.vendorName ?? po.vendorCodeText ?? '—',
      title: (po) => po.vendorName ?? po.vendorCodeText ?? '',
    },
    {
      id: 'pr_code',
      sortFilterField: 'prCodeText',
      header: 'PR No.',
      nowrap: true,
      render: (po) =>
        po.prCodeText ? (
          <span className="mono fw-700" style={{ color: 'var(--purple)' }}>
            {po.prCodeText}
          </span>
        ) : (
          <span className="text3">—</span>
        ),
    },
    {
      id: 'total_qty',
      sortFilterField: 'totalQty',
      filterType: 'num',
      header: 'Qty',
      align: 'right',
      nowrap: true,
      className: 'mono fw-700',
      render: (po) => po.totalQty,
    },
    {
      id: 'received_qty',
      sortFilterField: 'receivedQty',
      filterType: 'num',
      header: 'Received',
      align: 'right',
      nowrap: true,
      render: (po) => (
        <span
          className="mono fw-700"
          style={{ color: po.receivedQty > 0 ? 'var(--green)' : 'var(--text3)' }}
        >
          {po.receivedQty}
        </span>
      ),
    },
    {
      id: 'accepted_qty',
      // No sortFilterField yet — the server does not register a qcAcceptedQty
      // sort/filter column; naming one here would break sorting. To follow.
      header: 'Accepted',
      align: 'right',
      nowrap: true,
      render: (po) => (
        <span
          className="mono fw-700"
          style={{ color: po.qcAcceptedQty > 0 ? 'var(--green)' : 'var(--text3)' }}
        >
          {po.qcAcceptedQty}
        </span>
      ),
    },
    {
      id: 'pending_qty',
      sortFilterField: 'pendingQty',
      filterType: 'num',
      header: 'Pending',
      align: 'right',
      nowrap: true,
      render: (po) => (
        <span
          className="mono fw-700"
          style={{ color: po.pendingQty > 0 ? 'var(--blue)' : 'var(--green)' }}
        >
          {po.pendingQty}
        </span>
      ),
    },
    {
      id: 'value',
      sortFilterField: canSeePrice ? 'totalAmount' : undefined,
      filterType: 'num',
      header: 'Value',
      align: 'right',
      nowrap: true,
      // null = prices hidden for this viewer (API-side gate) — keep the gate.
      render: (po) =>
        po.totalAmount == null ? (
          <span className="text3">—</span>
        ) : (
          <span className="mono">{inr(po.totalAmount)}</span>
        ),
    },
    {
      id: 'po_status',
      sortFilterField: 'status',
      filterOptions: PO_STATUS_OPTIONS,
      kind: 'badge',
      header: 'PO Status',
      nowrap: true,
      render: (po) => <PoStatusBadge status={po.status} />,
    },
    {
      // When the PO record was entered (IST day) — Sort & Filter can pick a
      // range of it (ADR-200). Off by default; Columns ▾ shows it.
      id: 'created_on',
      sortFilterField: 'createdOn',
      kind: 'date',
      header: 'Created On',
      className: 'mono',
      nowrap: true,
      render: (po) => fmtDate(po.createdAt),
    },
  ];
}
