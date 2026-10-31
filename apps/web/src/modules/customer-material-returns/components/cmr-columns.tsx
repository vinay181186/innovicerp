// Customer Material Return register columns — ONE ROW PER RETURN LINE (ADR-261,
// GET /customer-material-returns/lines). ADR-199 fit table, ADR-200 server
// Sort & Filter.
//
// The lead block comes first and is locked (leadColumns, JWSO-only list: no
// Internal SO No.): JWSO No. · POL · Created On · Item Code/Rev · Item Name —
// the JWSO line the material belongs to. Then Return No. · Return Date ·
// Customer · Return Qty · Return Kind · Customer RM · Return Status ·
// Vehicle No. Remarks, the cancel reason and History live in the ▸ row.
//
// `sortFilterField` names the field in the API's
// CUSTOMER_MATERIAL_RETURN_LINE_SF_COLUMNS map.

import type { CustomerMaterialReturnKind, CustomerMaterialReturnLineRow } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { statusText } from '@/lib/status-text';
import { type DataTableColumn, leadColumns } from '@/ui/data';

/** The two kinds of returned line, in the words the store uses. */
export const CMR_KIND_LABEL: Record<CustomerMaterialReturnKind, string> = {
  good: 'Good — spare',
  rejected: 'Deviated at QC',
};

const STATUS_OPTIONS = [
  { value: 'issued', label: statusText('issued') },
  { value: 'cancelled', label: statusText('cancelled') },
];

const KIND_OPTIONS = [
  { value: 'good', label: CMR_KIND_LABEL.good },
  { value: 'rejected', label: CMR_KIND_LABEL.rejected },
];

type Row = CustomerMaterialReturnLineRow;

export function cmrColumns(): DataTableColumn<Row>[] {
  return [
    ...leadColumns<Row>({
      so: 'jwso',
      soNo: (r) => r.jwCode,
      pol: (r) => r.clientPoLineNo,
      createdOn: (r) => r.createdAt,
      itemCode: (r) => r.itemCode,
      itemRev: (r) => r.itemRevision,
      itemName: (r) => r.itemName,
      overrides: {
        so_no: { sortFilterField: 'jwCode' },
        client_po_line_no: { sortFilterField: 'clientPoLineNo' },
        created_on: { sortFilterField: 'createdOn' },
        item_code: { sortFilterField: 'itemCode' },
        item_name: { sortFilterField: 'itemName' },
      },
    }),
    {
      id: 'return_no',
      sortFilterField: 'code',
      kind: 'code',
      header: 'Return No.',
      nowrap: true,
      render: (r) => (
        <span className="td-code" style={{ color: 'var(--text)', fontWeight: 800 }}>
          {r.docCode}
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
      render: (r) => fmtDate(r.docDate),
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
      id: 'qty',
      sortFilterField: 'qty',
      kind: 'num',
      header: 'Return Qty',
      align: 'right',
      headColor: 'var(--green2)',
      className: 'mono fw-700',
      nowrap: true,
      render: (r) => <span style={{ color: 'var(--green2)' }}>{r.qty}</span>,
    },
    {
      id: 'kind',
      sortFilterField: 'kind',
      filterType: 'list',
      filterOptions: KIND_OPTIONS,
      kind: 'badge',
      header: 'Return Kind',
      nowrap: true,
      render: (r) => (
        <span className={`badge ${r.kind === 'rejected' ? 'b-red' : 'b-green'}`}>
          {CMR_KIND_LABEL[r.kind]}
        </span>
      ),
    },
    {
      id: 'rm_code',
      sortFilterField: 'rmItemCode',
      kind: 'code',
      header: 'Customer RM',
      className: 'td-code',
      nowrap: true,
      render: (r) => r.rmItemCode ?? '—',
    },
    {
      id: 'status',
      sortFilterField: 'status',
      filterType: 'list',
      filterOptions: STATUS_OPTIONS,
      kind: 'badge',
      header: 'Return Status',
      render: (r) => (
        <span className={`badge ${r.docStatus === 'cancelled' ? 'b-red' : 'b-green'}`}>
          {statusText(r.docStatus)}
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
