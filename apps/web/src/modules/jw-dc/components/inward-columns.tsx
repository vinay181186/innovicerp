// Inward Register columns (ADR-199 fit table). The first column (Inward No.) is
// pinned by the stylesheet. Numbers right-align, text centres, Vendor left-
// aligns and ellipsises. Vendor Challan No. and the GRN link moved into the ▸
// detail row (see inward-register). Received / Accepted / Rejected are the
// receipt's qty and its incoming-QC outcome (0172).

import { type JwDcInwardListItem } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import type { DataTableColumn } from '@/ui/data';

export function inwardColumns(): DataTableColumn<JwDcInwardListItem>[] {
  return [
    {
      id: 'inward_no',
      sortFilterField: 'code',
      filterType: 'text',
      kind: 'code',
      header: 'Inward No.',
      className: 'mono fw-700',
      nowrap: true,
      render: (inv) => <span style={{ color: 'var(--green2)' }}>{inv.code}</span>,
    },
    {
      id: 'inward_date',
      sortFilterField: 'inwardDate',
      kind: 'date',
      header: 'Inward Date',
      className: 'mono text2',
      nowrap: true,
      render: (inv) => fmtDate(inv.inwardDate),
    },
    {
      id: 'dc_no',
      sortFilterField: 'dcNo',
      filterType: 'text',
      kind: 'code',
      header: 'DC No.',
      className: 'mono',
      nowrap: true,
      render: (inv) => <span style={{ color: 'var(--purple)' }}>{inv.dcCodeText ?? '—'}</span>,
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
      render: (inv) => inv.vendorName ?? inv.vendorNameText ?? '—',
      title: (inv) => inv.vendorName ?? inv.vendorNameText ?? '',
    },
    {
      id: 'received',
      sortFilterField: 'receivedQty',
      kind: 'num',
      header: 'Received',
      align: 'right',
      className: 'mono fw-700',
      render: (inv) => inv.totalReceivedQty,
    },
    {
      id: 'accepted',
      sortFilterField: 'acceptedQty',
      kind: 'num',
      header: 'Accepted',
      align: 'right',
      headColor: 'var(--green2)',
      className: 'mono',
      render: (inv) => <span style={{ color: 'var(--green2)' }}>{inv.totalOkQty}</span>,
    },
    {
      id: 'rejected',
      sortFilterField: 'rejectedQty',
      kind: 'num',
      header: 'Deviated',
      align: 'right',
      headColor: 'var(--red2)',
      className: 'mono',
      render: (inv) => (
        <span style={{ color: 'var(--red2)' }}>
          {inv.totalRejectedQty > 0 ? inv.totalRejectedQty : '—'}
        </span>
      ),
    },
  ];
}
