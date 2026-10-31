// Purchase Order list columns (ADR-199 fit table). ADR-261 (2026-10-31): ONE
// ROW PER PO LINE (GET /purchase-orders/lines), opening with PO No. and the
// six lead columns — SO No. · Internal SO No. · POL · Created On · Item Code
// (CODE/REV) · Item Name — then PO Date · PO Type · Vendor · PR No. · Qty · GRN
// Received · Accepted · Pending · Value · PO Status. Qty / Received / Accepted
// / Pending / Value are the LINE's own. Value keeps its price gate: the API
// nulls `amount` when the viewer may not see prices, and that null renders "—".

import type { PurchaseOrderLineListItem } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fmtDate } from '@/lib/date';
import { Badge } from '@/ui/core';
import { leadColumns, type DataTableColumn } from '@/ui/data';
import { PO_STATUS_CHOICES, PO_STATUS_LABELS, PO_TYPE_LABELS } from '../lib/po-labels';
import { PoStatusBadge } from './po-status-badge';

// Whole rupees, Indian grouping — the same shape the Invoices list uses.
const inr = (v: number): string => `₹${Math.round(v).toLocaleString('en-IN')}`;

/** Sort & Filter tick lists (server mode): stored code → the label shown. */
const toOptions = (labels: Record<string, string>): Array<{ value: string; label: string }> =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));
// Only the four live statuses are offered (ADR-222). The filter is a server
// match on the STORED code, so the seven legacy `partial` / `qc_pending` rows
// — which read "Open" on screen — are not returned by the Open tick. They are
// still reachable with no status filter at all; folding them into Open is an
// API-side change, not one this list can make.
const PO_STATUS_OPTIONS = PO_STATUS_CHOICES.map((value) => ({
  value,
  label: PO_STATUS_LABELS[value],
}));
const PO_TYPE_OPTIONS = toOptions(PO_TYPE_LABELS);

/** `canSeePrice` — Value is sortable / filterable only for a user who may see
 *  PO prices (the API refuses it otherwise; ADR-200). */
export function purchaseOrderListColumns({
  canSeePrice,
  draftIds,
}: {
  canSeePrice: boolean;
  /** ADR-202 — PO ids with a pending edit; their status cell shows "Draft". */
  draftIds?: Set<string>;
}): DataTableColumn<PurchaseOrderLineListItem>[] {
  return [
    ...leadColumns<PurchaseOrderLineListItem>({
      doc: {
        id: 'po_code',
        sortFilterField: 'poCode',
        header: 'PO No.',
        nowrap: true,
        render: (po) => (
          <Link
            to="/purchase-orders/$id"
            params={{ id: po.docId }}
            className="td-code"
            style={{ color: 'var(--blue)', fontWeight: 800 }}
            title="Open the PO detail page"
            onClick={(e) => e.stopPropagation()}
          >
            {po.docCode}
          </Link>
        ),
      },
      docDate: {
        id: 'po_date',
        sortFilterField: 'poDate',
        kind: 'date',
        header: 'PO Date',
        className: 'mono',
        nowrap: true,
        render: (po) => fmtDate(po.docDate),
      },
      soNo: (l) => l.soCode,
      internalSoNo: (l) => l.soInternalNo,
      pol: (l) => l.clientPoLineNo,
      createdOn: (l) => l.createdAt,
      itemCode: (l) => l.itemCode,
      itemRev: (l) => l.itemRevision,
      itemName: (l) => l.itemName,
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
      render: (po) => po.qty,
    },
    {
      id: 'received_qty',
      sortFilterField: 'grnReceivedQty',
      filterType: 'num',
      header: 'GRN Received',
      align: 'right',
      nowrap: true,
      render: (po) => (
        <span
          className="mono fw-700"
          style={{ color: po.grnReceivedQty > 0 ? 'var(--green)' : 'var(--text3)' }}
        >
          {po.grnReceivedQty}
        </span>
      ),
    },
    {
      id: 'accepted_qty',
      sortFilterField: 'qcAcceptedQty',
      filterType: 'num',
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
        po.amount == null ? (
          <span className="text3">—</span>
        ) : (
          <span className="mono">{inr(po.amount)}</span>
        ),
    },
    {
      id: 'po_status',
      sortFilterField: 'status',
      filterOptions: PO_STATUS_OPTIONS,
      kind: 'badge',
      header: 'PO Status',
      nowrap: true,
      render: (po) => <PoStatusBadge status={po.docStatus} draft={draftIds?.has(po.docId)} />,
    },
  ];
}
