// Vendor-wise and SO/JW-wise Open PO summary columns for the Supply Chain
// Dashboard. These are keyless classic DataTables (each has its own column
// shape, different from the headline Pending PO Tracker — ADR-199 says render a
// genuinely different shape as a keyless sheet, not invent another tableKey).
// Numbers right-align; names left + ellipsis; money columns drop when prices
// are hidden.

import type { ScSoRow, ScVendorRow } from '@innovic/shared';
import type { DataTableColumn } from '@/ui/data';
import { inr } from './sc-format';

export function vendorColumns(priceHidden: boolean): DataTableColumn<ScVendorRow>[] {
  const cols: DataTableColumn<ScVendorRow>[] = [
    {
      id: 'vendor_name',
      sortFilterField: 'vendorName',
      kind: 'text',
      header: 'Vendor Name',
      align: 'left',
      ellipsis: true,
      className: 'fw-700',
      render: (v) => v.vendorName ?? v.vendorCode ?? '—',
      title: (v) => v.vendorName ?? v.vendorCode ?? '',
    },
    {
      id: 'vendor_code',
      sortFilterField: 'vendorCode',
      kind: 'code',
      header: 'Vendor Code',
      className: 'td-code',
      render: (v) => v.vendorCode ?? '—',
    },
    {
      id: 'po_lines',
      sortFilterField: 'lines',
      kind: 'num',
      header: 'PO Lines',
      align: 'right',
      className: 'mono',
      render: (v) => v.lines,
    },
    {
      id: 'items',
      sortFilterField: 'uniqueItems',
      kind: 'num',
      header: 'Items',
      align: 'right',
      render: (v) => v.uniqueItems,
    },
    {
      id: 'order_qty',
      sortFilterField: 'totalQty',
      kind: 'num',
      header: 'Order Qty',
      align: 'right',
      className: 'mono fw-700',
      render: (v) => v.totalQty,
    },
    {
      id: 'received',
      sortFilterField: 'receivedQty',
      kind: 'num',
      header: 'Received',
      align: 'right',
      headColor: 'var(--green2)',
      className: 'mono fw-700',
      render: (v) => <span style={{ color: 'var(--green2)' }}>{v.receivedQty}</span>,
    },
    {
      id: 'pending_qty',
      sortFilterField: 'pendingQty',
      kind: 'num',
      header: 'Pending Qty',
      align: 'right',
      headColor: 'var(--red2)',
      className: 'mono fw-700',
      render: (v) => <span style={{ color: 'var(--red2)' }}>{v.totalQty - v.receivedQty}</span>,
    },
  ];
  if (!priceHidden) {
    cols.push(
      {
        id: 'order_value',
        sortFilterField: 'totalVal',
        kind: 'num',
        header: 'Order Value',
        align: 'right',
        className: 'mono',
        render: (v) => `₹${inr(v.totalVal)}`,
      },
      {
        id: 'pending_value',
        sortFilterField: 'pendingVal',
        kind: 'num',
        header: 'Pending Value',
        align: 'right',
        headColor: 'var(--amber2)',
        className: 'mono fw-700',
        render: (v) => <span style={{ color: 'var(--amber2)' }}>₹{inr(v.pendingVal)}</span>,
      },
    );
  }
  return cols;
}

export function soColumns(priceHidden: boolean): DataTableColumn<ScSoRow>[] {
  const cols: DataTableColumn<ScSoRow>[] = [
    {
      id: 'so_no',
      sortFilterField: 'soCode',
      kind: 'code',
      header: 'SO / JWSO No.',
      className: 'td-code',
      render: (s) => s.soCode || <span className="text3">No SO / JWSO linked</span>,
    },
    {
      // ADR-207 — the office's own Internal SO No., in its own column beside
      // the system SO / JWSO No. so the two can be told apart.
      id: 'so_internal_no',
      sortFilterField: 'soInternalNo',
      kind: 'code',
      header: 'Internal SO No.',
      className: 'mono fw-700',
      render: (s) => <span style={{ color: 'var(--text)' }}>{s.soInternalNo?.trim() || '—'}</span>,
    },
    {
      id: 'po_lines',
      sortFilterField: 'lines',
      kind: 'num',
      header: 'PO Lines',
      align: 'right',
      className: 'mono',
      render: (s) => s.lines,
    },
    {
      id: 'vendors',
      sortFilterField: 'uniqueVendors',
      kind: 'num',
      header: 'Vendors',
      align: 'right',
      render: (s) => s.uniqueVendors,
    },
    {
      id: 'order_qty',
      sortFilterField: 'totalQty',
      kind: 'num',
      header: 'Order Qty',
      align: 'right',
      className: 'mono fw-700',
      render: (s) => s.totalQty,
    },
    {
      id: 'received',
      sortFilterField: 'receivedQty',
      kind: 'num',
      header: 'Received',
      align: 'right',
      headColor: 'var(--green2)',
      className: 'mono fw-700',
      render: (s) => <span style={{ color: 'var(--green2)' }}>{s.receivedQty}</span>,
    },
    {
      id: 'pending_qty',
      sortFilterField: 'pendingQty',
      kind: 'num',
      header: 'Pending Qty',
      align: 'right',
      headColor: 'var(--red2)',
      className: 'mono fw-700',
      render: (s) => <span style={{ color: 'var(--red2)' }}>{s.totalQty - s.receivedQty}</span>,
    },
  ];
  if (!priceHidden) {
    cols.push(
      {
        id: 'order_value',
        sortFilterField: 'totalVal',
        kind: 'num',
        header: 'Order Value',
        align: 'right',
        className: 'mono',
        render: (s) => `₹${inr(s.totalVal)}`,
      },
      {
        id: 'pending_value',
        sortFilterField: 'pendingVal',
        kind: 'num',
        header: 'Pending Value',
        align: 'right',
        headColor: 'var(--amber2)',
        className: 'mono fw-700',
        render: (s) => <span style={{ color: 'var(--amber2)' }}>₹{inr(s.pendingVal)}</span>,
      },
    );
  }
  return cols;
}
