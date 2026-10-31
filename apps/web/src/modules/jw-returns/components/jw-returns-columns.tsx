// JW Return register columns (ADR-199 fit table: one line per row, always fits
// the screen — no sideways scroll; the rightmost columns drop into the ▸ detail
// row when narrow). The lead columns (JWSO No. · POL · Created On · Item Code ·
// Item Name, owner rule 2026-10-31) come first, then Return No.
// Numbers right-align, codes/dates never wrap, Customer and Item Name left-align
// and ellipsise. Transporter and Vehicle No. live in the ▸ detail row (see
// jw-dispatch-view).

import { type JwReturnChallanListItem } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { statusText } from '@/lib/status-text';
import { leadColumns, type DataTableColumn } from '@/ui/data';

const STATUS_OPTIONS = [
  { value: 'issued', label: statusText('issued') },
  { value: 'cancelled', label: statusText('cancelled') },
];

export function jwReturnColumns(): DataTableColumn<JwReturnChallanListItem>[] {
  return [
    // Owner rule 2026-10-31 — the lead columns first (JWSO-only list: JWSO No.,
    // no Internal SO No.); Return No. and Customer after Item Name.
    ...leadColumns<JwReturnChallanListItem>({
      so: 'jwso',
      soNo: (r) => r.jwCodeText,
      pol: (r) => r.clientPoLineNo,
      createdOn: (r) => r.createdAt,
      itemCode: (r) => r.itemCode,
      itemRev: (r) => r.itemRevision,
      itemName: (r) => r.partName,
      overrides: {
        so_no: { sortFilterField: 'jwsoCode' },
        item_code: { sortFilterField: 'itemCode' },
        item_name: { sortFilterField: 'itemName' },
      },
    }),
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
