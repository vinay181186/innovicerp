// Complete Purchase Summary + Recent GRN Activity columns for the Supply Chain
// Dashboard. Keyless classic DataTables (own column shapes, different from the
// headline Pending PO Tracker — ADR-199). Numbers right-align; names left +
// ellipsis; the money columns drop out when the server hides prices.

import type { ScPoSummaryRow, ScRecentGrn } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fmtDate } from '@/lib/date';
import type { DataTableColumn } from '@/ui/data';
import { inr, statusBadge } from './sc-format';

export function poSummaryColumns(priceHidden: boolean): DataTableColumn<ScPoSummaryRow>[] {
  const cols: DataTableColumn<ScPoSummaryRow>[] = [
    {
      id: 'po_no',
      kind: 'code',
      header: 'PO No.',
      className: 'td-code',
      render: (g) => (
        <Link
          to="/purchase-orders/$id"
          params={{ id: g.poId }}
          className="cyan"
          style={{ textDecoration: 'none' }}
          onClick={(e) => e.stopPropagation()}
        >
          {g.poNo}
        </Link>
      ),
    },
    { id: 'po_date', kind: 'date', header: 'PO Date', render: (g) => fmtDate(g.poDate) },
    {
      id: 'vendor',
      kind: 'text',
      header: 'Vendor',
      align: 'left',
      ellipsis: true,
      className: 'fw-700',
      render: (g) => g.vendorName ?? g.vendorCode ?? '—',
      title: (g) => g.vendorName ?? g.vendorCode ?? '',
    },
    {
      id: 'so_no',
      kind: 'code',
      header: 'SO / JWSO No.',
      className: 'text2',
      render: (g) => g.soCode ?? '—',
    },
    {
      id: 'lines',
      kind: 'num',
      header: 'Lines',
      align: 'right',
      className: 'mono',
      render: (g) => g.lines,
    },
    {
      id: 'order_qty',
      kind: 'num',
      header: 'Order Qty',
      align: 'right',
      className: 'mono fw-700',
      render: (g) => g.totalQty,
    },
    {
      id: 'received',
      kind: 'num',
      header: 'Received',
      align: 'right',
      headColor: 'var(--green2)',
      className: 'mono fw-700',
      render: (g) => <span style={{ color: 'var(--green2)' }}>{g.receivedQty}</span>,
    },
    {
      id: 'pending',
      kind: 'num',
      header: 'Pending',
      align: 'right',
      headColor: 'var(--red2)',
      className: 'mono fw-700',
      render: (g) => {
        const pend = g.totalQty - g.receivedQty;
        return <span style={{ color: pend > 0 ? 'var(--red)' : 'var(--green)' }}>{pend}</span>;
      },
    },
  ];
  if (!priceHidden) {
    cols.push(
      {
        id: 'subtotal',
        kind: 'num',
        header: 'Subtotal',
        align: 'right',
        className: 'mono',
        render: (g) => `₹${inr(g.totalVal)}`,
      },
      {
        id: 'tax',
        kind: 'num',
        header: 'Tax',
        align: 'right',
        headColor: 'var(--amber2)',
        className: 'mono',
        render: (g) => <span style={{ color: 'var(--amber2)' }}>₹{inr(g.taxAmount)}</span>,
      },
      {
        id: 'grand_total',
        kind: 'num',
        header: 'Grand Total',
        align: 'right',
        headColor: 'var(--green2)',
        className: 'mono fw-700',
        render: (g) => <span style={{ color: 'var(--green2)' }}>₹{inr(g.grandTotal)}</span>,
      },
    );
  }
  cols.push(
    { id: 'grns', kind: 'num', header: 'GRNs', align: 'right', render: (g) => g.grnCount },
    {
      id: 'po_status',
      kind: 'badge',
      header: 'PO Status',
      filterValue: (g) => statusBadge(g.status).label,
      render: (g) => {
        const sb = statusBadge(g.status);
        return <span className={`badge ${sb.cls}`}>{sb.label}</span>;
      },
    },
  );
  return cols;
}

export function recentGrnColumns(): DataTableColumn<ScRecentGrn>[] {
  return [
    {
      id: 'grn_no',
      kind: 'code',
      header: 'GRN No.',
      className: 'td-code cyan',
      render: (g) => g.grnNo,
    },
    { id: 'grn_date', kind: 'date', header: 'GRN Date', render: (g) => fmtDate(g.grnDate) },
    {
      id: 'po_no',
      kind: 'code',
      header: 'PO No.',
      className: 'mono',
      render: (g) => <span style={{ color: 'var(--blue)' }}>{g.poNo ?? 'Manual'}</span>,
    },
    {
      id: 'vendor',
      kind: 'text',
      header: 'Vendor',
      align: 'left',
      ellipsis: true,
      render: (g) => g.vendorName ?? g.vendorCode ?? '—',
      title: (g) => g.vendorName ?? g.vendorCode ?? '',
    },
  ];
}
