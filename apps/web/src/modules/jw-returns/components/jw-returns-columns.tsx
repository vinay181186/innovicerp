// JW Return register columns (ADR-199 fit table: one line per row, always fits
// the screen — no sideways scroll; the rightmost columns drop into the ▸ detail
// row when narrow). The first column (Return No.) is pinned by the stylesheet.
// Numbers right-align, codes/dates never wrap, Customer and Item Name left-align
// and ellipsise. Transporter and Vehicle No. live in the ▸ detail row (see
// jw-dispatch-view).

import { type JwReturnChallanListItem } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { statusText } from '@/lib/status-text';
import type { DataTableColumn } from '@/ui/data';

const STATUS_OPTIONS = [
  { value: 'issued', label: statusText('issued') },
  { value: 'cancelled', label: statusText('cancelled') },
];

export function jwReturnColumns(): DataTableColumn<JwReturnChallanListItem>[] {
  return [
    {
      id: 'return_no',
      sortFilterField: 'returnCode',
      kind: 'code',
      header: 'Return No.',
      className: 'td-code',
      nowrap: true,
      render: (r) => <span style={{ color: 'var(--cyan)' }}>{r.code}</span>,
    },
    {
      id: 'return_date',
      sortFilterField: 'returnDate',
      kind: 'date',
      header: 'Return Date',
      className: 'mono text2',
      nowrap: true,
      render: (r) => fmtDate(r.returnDate),
    },
    {
      id: 'jwso',
      sortFilterField: 'jwsoCode',
      kind: 'code',
      header: 'JWSO',
      className: 'mono fw-700',
      nowrap: true,
      render: (r) => <span style={{ color: 'var(--purple)' }}>{r.jwCodeText ?? '—'}</span>,
    },
    {
      id: 'customer',
      sortFilterField: 'customer',
      kind: 'text',
      header: 'Customer',
      align: 'left',
      ellipsis: true,
      className: 'fw-700',
      render: (r) => r.clientName ?? '—',
      title: (r) => r.clientName ?? '',
    },
    {
      id: 'item_code',
      sortFilterField: 'itemCode',
      kind: 'code',
      header: 'Item Code',
      className: 'td-code',
      nowrap: true,
      render: (r) => itemCodeWithRev(r.itemCode, r.itemRevision),
    },
    {
      id: 'item_name',
      sortFilterField: 'itemName',
      kind: 'text',
      header: 'Item Name',
      align: 'left',
      ellipsis: true,
      className: 'text2',
      render: (r) => r.partName ?? '—',
      title: (r) => r.partName ?? '',
    },
    {
      id: 'return_qty',
      sortFilterField: 'qty',
      kind: 'num',
      header: 'Return Qty',
      align: 'right',
      headColor: 'var(--green2)',
      className: 'mono fw-700',
      render: (r) => <span style={{ color: 'var(--green2)' }}>{r.qty}</span>,
    },
    {
      id: 'status',
      sortFilterField: 'status',
      filterType: 'list',
      filterOptions: STATUS_OPTIONS,
      kind: 'badge',
      header: 'Return Status',
      render: (r) => (
        <span className={`badge ${r.status === 'cancelled' ? 'b-red' : 'b-green'}`}>
          {statusText(r.status)}
        </span>
      ),
    },
  ];
}
