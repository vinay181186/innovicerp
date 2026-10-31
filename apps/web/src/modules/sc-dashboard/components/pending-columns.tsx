// Pending PO Tracker columns for the ADR-199 fit sheet (the headline table on
// the Supply Chain Dashboard, carrying TABLE_KEYS.scDashboard). One row per PO
// line. ADR-261: opens with PO No. and the six lead columns (SO No. — the SO,
// else the JWSO — · Internal SO No. · POL · Created On · Item Code · Item
// Name), then Ln · PO Date · Vendor · quantities; the money columns drop out when
// the server hides prices.

import type { ScPendingLine } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fmtDate } from '@/lib/date';
import { leadColumns, type DataTableColumn } from '@/ui/data';
import { inr, PO_STATUS_OPTIONS, statusBadge } from './sc-format';

export function pendingColumns(priceHidden: boolean): DataTableColumn<ScPendingLine>[] {
  const cols: DataTableColumn<ScPendingLine>[] = [
    ...leadColumns<ScPendingLine>({
      doc: {
        id: 'po_no',
        sortFilterField: 'poNo',
        kind: 'code',
        header: 'PO No.',
        className: 'td-code',
        render: (p) => (
          <Link
            to="/purchase-orders/$id"
            params={{ id: p.poId }}
            className="cyan"
            style={{ textDecoration: 'underline dotted' }}
            onClick={(e) => e.stopPropagation()}
          >
            {p.poNo}
          </Link>
        ),
      },
      docDate: {
        id: 'po_date',
        sortFilterField: 'poDate',
        kind: 'date',
        header: 'PO Date',
        render: (p) => fmtDate(p.poDate),
      },
      soNo: (p) => p.soCode,
      internalSoNo: (p) => p.soInternalNo,
      pol: (p) => p.clientPoLineNo,
      createdOn: (p) => p.createdAt,
      itemCode: (p) => p.itemCode,
      itemRev: (p) => p.itemRevision,
      itemName: (p) => p.itemName,
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
      id: 'ln',
      sortFilterField: 'lineNo',
      filterType: 'num',
      kind: 'code',
      header: 'Ln',
      className: 'mono',
      render: (p) => p.lineNo,
    },
    {
      id: 'vendor',
      sortFilterField: 'vendor',
      kind: 'text',
      header: 'Vendor',
      align: 'left',
      ellipsis: true,
      className: 'fw-700',
      render: (p) => p.vendorName ?? p.vendorCode ?? '—',
      title: (p) => p.vendorName ?? p.vendorCode ?? '',
    },
    {
      id: 'order_qty',
      sortFilterField: 'qty',
      kind: 'num',
      header: 'Order Qty',
      align: 'right',
      className: 'mono fw-700',
      render: (p) => p.qty,
    },
    {
      id: 'received',
      sortFilterField: 'receivedQty',
      kind: 'num',
      header: 'Received',
      align: 'right',
      headColor: 'var(--green2)',
      className: 'mono fw-700',
      render: (p) => <span style={{ color: 'var(--green2)' }}>{p.receivedQty}</span>,
    },
    {
      id: 'pending',
      sortFilterField: 'pendingQty',
      kind: 'num',
      header: 'Pending',
      align: 'right',
      headColor: 'var(--red2)',
      className: 'mono fw-700',
      render: (p) => <span style={{ color: 'var(--red2)' }}>{p.pendingQty}</span>,
    },
  ];
  if (!priceHidden) {
    cols.push(
      {
        id: 'rate',
        sortFilterField: 'rate',
        kind: 'num',
        header: 'Rate',
        align: 'right',
        className: 'mono',
        render: (p) => (p.rate ? `₹${p.rate.toFixed(2)}` : '—'),
      },
      {
        id: 'pending_value',
        sortFilterField: 'pendingVal',
        kind: 'num',
        header: 'Pending Value',
        align: 'right',
        headColor: 'var(--amber2)',
        className: 'mono fw-700',
        render: (p) => (
          <span style={{ color: 'var(--amber2)' }}>
            {(p.pendingVal ?? 0) > 0 ? `₹${inr(p.pendingVal)}` : '—'}
          </span>
        ),
      },
    );
  }
  cols.push({
    id: 'po_status',
    sortFilterField: 'status',
    filterOptions: PO_STATUS_OPTIONS,
    kind: 'badge',
    header: 'PO Status',
    filterValue: (p) => statusBadge(p.status).label,
    render: (p) => {
      const sb = statusBadge(p.status);
      return <span className={`badge ${sb.cls}`}>{sb.label}</span>;
    },
  });
  return cols;
}
