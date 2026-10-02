// Outward Register columns (ADR-199 fit table: one line per row, always fits
// the screen). The first column (DC No.) is pinned by the stylesheet. Numbers
// right-align, text centres, Vendor name left-aligns and ellipsises. The Items
// count, Vehicle and Remarks moved into the ▸ detail row (see outward-register).

import { type JwDcOutwardListItem } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fmtDate } from '@/lib/date';
import type { DataTableColumn } from '@/ui/data';

function statusLabel(s: JwDcOutwardListItem['returnStatus']): string {
  // Returned = done; Partly Returned / At Vendor = still under way.
  return s === 'fully_returned' ? 'Returned' : s === 'partial' ? 'Partly Returned' : 'At Vendor';
}

// Sort & Filter tick list (ADR-200): the stored status + the label shown.
const STATUS_OPTIONS = (['out', 'partial', 'fully_returned'] as const).map((s) => ({
  value: s,
  label: statusLabel(s),
}));

export function outwardColumns(): DataTableColumn<JwDcOutwardListItem>[] {
  return [
    {
      id: 'dc_no',
      sortFilterField: 'code',
      filterType: 'text',
      kind: 'code',
      header: 'DC No.',
      className: 'td-code',
      nowrap: true,
      render: (dc) => (
        <Link
          onClick={(e) => e.stopPropagation()}
          to="/jw-dc/$id"
          params={{ id: dc.id }}
          style={{ color: 'var(--purple)', textDecoration: 'underline dotted' }}
        >
          {dc.code}
        </Link>
      ),
    },
    {
      id: 'dc_date',
      sortFilterField: 'dcDate',
      kind: 'date',
      header: 'DC Date',
      className: 'mono text2',
      nowrap: true,
      render: (dc) => fmtDate(dc.dcDate),
    },
    {
      id: 'po_no',
      sortFilterField: 'poNo',
      filterType: 'text',
      kind: 'code',
      header: 'PO No.',
      className: 'mono',
      nowrap: true,
      render: (dc) => <span style={{ color: 'var(--cyan)' }}>{dc.jwpoCodeText ?? '—'}</span>,
    },
    {
      id: 'so_no',
      sortFilterField: 'soNo',
      filterType: 'text',
      kind: 'code',
      header: 'SO No.',
      className: 'mono',
      nowrap: true,
      render: (dc) => <span style={{ color: 'var(--cyan)' }}>{dc.soCode ?? '—'}</span>,
    },
    {
      id: 'vendor',
      sortFilterField: 'vendor',
      filterType: 'text',
      kind: 'text',
      header: 'Vendor',
      align: 'left',
      ellipsis: true,
      className: 'fw-700',
      render: (dc) => dc.vendorName ?? dc.vendorNameText ?? dc.vendorCodeText ?? '—',
      title: (dc) => dc.vendorName ?? dc.vendorNameText ?? dc.vendorCodeText ?? '',
    },
    {
      id: 'sent',
      sortFilterField: 'sentQty',
      kind: 'num',
      header: 'Sent',
      align: 'right',
      headColor: 'var(--purple)',
      className: 'mono fw-700',
      render: (dc) => <span style={{ color: 'var(--purple)' }}>{dc.totalSentQty}</span>,
    },
    {
      id: 'received',
      sortFilterField: 'receivedQty',
      kind: 'num',
      header: 'Received',
      align: 'right',
      headColor: 'var(--green2)',
      className: 'mono',
      render: (dc) => <span style={{ color: 'var(--green2)' }}>{dc.totalReturnedQty}</span>,
    },
    {
      id: 'pending',
      sortFilterField: 'pendingQty',
      kind: 'num',
      header: 'Pending',
      align: 'right',
      headColor: 'var(--red2)',
      className: 'mono fw-700',
      render: (dc) => (
        <span style={{ color: dc.pendingQty > 0 ? 'var(--red)' : 'var(--green)' }}>
          {dc.pendingQty}
        </span>
      ),
    },
    {
      id: 'status',
      sortFilterField: 'returnStatus',
      filterOptions: STATUS_OPTIONS,
      kind: 'badge',
      header: 'DC Status',
      render: (dc) => (
        <span className={`badge ${dc.returnStatus === 'fully_returned' ? 'b-green' : 'b-amber'}`}>
          {statusLabel(dc.returnStatus)}
        </span>
      ),
    },
  ];
}
