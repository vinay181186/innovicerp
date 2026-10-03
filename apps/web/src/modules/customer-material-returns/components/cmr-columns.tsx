// Customer Material Return register columns (ADR-199 fit table, ADR-200 server
// Sort & Filter). First column (Return No.) is pinned by the stylesheet.
// Numbers right-align; codes / dates never wrap; Customer left-aligns and
// ellipsises. Remarks and the cancel reason live in the ▸ detail row.
//
// `sortFilterField` names the field in the API's customer-material-returns
// sf-columns map.

import type { CustomerMaterialReturn, CustomerMaterialReturnKind } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { statusText } from '@/lib/status-text';
import type { DataTableColumn } from '@/ui/data';

/** The two kinds of returned line, in the words the store uses. */
export const CMR_KIND_LABEL: Record<CustomerMaterialReturnKind, string> = {
  good: 'Good — spare',
  rejected: 'Deviated at QC',
};

const STATUS_OPTIONS = [
  { value: 'issued', label: statusText('issued') },
  { value: 'cancelled', label: statusText('cancelled') },
];

export function cmrColumns(): DataTableColumn<CustomerMaterialReturn>[] {
  return [
    {
      id: 'return_no',
      sortFilterField: 'code',
      kind: 'code',
      header: 'Return No.',
      nowrap: true,
      render: (r) => (
        <span className="td-code" style={{ color: 'var(--text)', fontWeight: 800 }}>
          {r.code}
        </span>
      ),
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
      id: 'jwso_code',
      sortFilterField: 'jwCode',
      kind: 'code',
      header: 'JWSO No.',
      className: 'mono fw-700',
      nowrap: true,
      render: (r) => <span style={{ color: 'var(--purple)' }}>{r.jwCode ?? '—'}</span>,
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
      id: 'total_qty',
      sortFilterField: 'totalQty',
      kind: 'num',
      header: 'Total Qty',
      align: 'right',
      headColor: 'var(--green2)',
      className: 'mono fw-700',
      nowrap: true,
      render: (r) => <span style={{ color: 'var(--green2)' }}>{r.totalQty}</span>,
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
    {
      id: 'vehicle_no',
      sortFilterField: 'vehicleNo',
      kind: 'code',
      header: 'Vehicle No.',
      className: 'mono text2',
      nowrap: true,
      render: (r) => r.vehicleNo ?? '—',
    },
  ];
}
