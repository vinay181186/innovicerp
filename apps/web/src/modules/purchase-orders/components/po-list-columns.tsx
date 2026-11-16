// Purchase Order list columns (ADR-199 fit table). ADR-303 (2026-11-16): ONE
// ROW PER PO again (GET /purchase-orders), after ADR-261's one-row-per-line
// spell. Lead block Sr No · PO No. · Created On · SO No. · Internal SO No. (no
// POL / Item Code / Item Name — a PO has many), then PO Date · PO Type · Vendor
// · PR No. · Lines · Qty · GRN Received · Accepted · Pending · Total Value
// (Basic) · PO Status · Created By. Qty columns are the PO's Σ over its lines;
// SO No. is the first line's order + a grey "+n" for the others. Total Value
// (Basic) = the PO subtotal (before GST); the API nulls it when the viewer may
// not see prices, and that null renders "—".

import { TOTAL_VALUE_BASIC_LABEL, type PurchaseOrderListItem } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fmtDate } from '@/lib/date';
import { Badge } from '@/ui/core';
import { createdByColumn, type DataTableColumn, leadColumns } from '@/ui/data';
import { PO_STATUS_CHOICES, PO_STATUS_LABELS, PO_TYPE_LABELS } from '../lib/po-labels';
import { FirstPlusMore } from './first-plus-more';
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
  firstRowNo,
  canSeePrice,
  draftIds,
}: {
  /** Sr No of the page's first row (offset + 1) — ADR-261 rev. */
  firstRowNo: number;
  canSeePrice: boolean;
  /** ADR-202 — PO ids with a pending edit; their status cell shows "Draft". */
  draftIds?: Set<string>;
}): DataTableColumn<PurchaseOrderListItem>[] {
  return [
    ...leadColumns<PurchaseOrderListItem>({
      firstRowNo,
      doc: {
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
      soNo: (po) => po.soCode,
      internalSoNo: (po) => po.soInternalNo,
      createdOn: (po) => po.createdAt,
      overrides: {
        so_no: {
          sortFilterField: 'soCode',
          render: (po) => <FirstPlusMore value={po.soCode} more={po.soExtraCount} />,
        },
        so_internal_no: { sortFilterField: 'soInternalNo' },
        created_on: { sortFilterField: 'createdOn' },
      },
    }),
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
          <span className="mono fw-700" style={{ color: 'var(--blue)' }}>
            {po.prCodeText}
          </span>
        ) : (
          <span className="text3">—</span>
        ),
    },
    {
      id: 'line_count',
      sortFilterField: 'lineCount',
      filterType: 'num',
      header: 'Lines',
      nowrap: true,
      className: 'mono',
      render: (po) => po.lineCount,
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
      id: 'total_value_basic',
      sortFilterField: canSeePrice ? 'subtotal' : undefined,
      filterType: 'num',
      header: TOTAL_VALUE_BASIC_LABEL,
      money: true,
      align: 'right',
      nowrap: true,
      // null = prices hidden for this viewer (API-side gate) — keep the gate.
      render: (po) =>
        po.subtotal == null ? (
          <span className="text3">—</span>
        ) : (
          <span className="mono">{inr(po.subtotal)}</span>
        ),
    },
    {
      id: 'po_status',
      sortFilterField: 'status',
      filterOptions: PO_STATUS_OPTIONS,
      kind: 'badge',
      header: 'PO Status',
      nowrap: true,
      render: (po) => <PoStatusBadge status={po.status} draft={draftIds?.has(po.id)} />,
    },
    // ADR-261 rev — Created By, the last data column.
    createdByColumn({
      createdByName: (r) => r.createdByName,
      overrides: { sortFilterField: 'createdBy' },
    }),
  ];
}
