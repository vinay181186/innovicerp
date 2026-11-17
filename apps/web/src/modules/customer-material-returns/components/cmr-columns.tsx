// Customer Material Return register columns — ONE ROW PER RETURN again
// (ADR-303, GET /customer-material-returns). ADR-199 fit table, ADR-200 server
// Sort & Filter.
//
// The locked lead block (leadColumns, JWSO-only list: no Internal SO No., and
// no POL / Item Code / Item Name on a document list): Sr No · Return No. ·
// Created On · SO No. (the JWSO No., or ADR-307 the SO No.). Then Return Date · Customer · Return Kind (the first
// line's kind + a grey "+n" when the lines carry both) · Lines · Return Qty
// (sum of the lines) · Return Status · Vehicle No. · Created By last. Remarks,
// the cancel reason and the lines are on the return's print (⋯ Preview).
//
// `sortFilterField` names the field in the API's
// CUSTOMER_MATERIAL_RETURN_SF_COLUMNS map (a Return Kind filter matches a
// return with ANY line of that kind).

import type { CustomerMaterialReturn, CustomerMaterialReturnKind } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { statusText } from '@/lib/status-text';
import { createdByColumn, type DataTableColumn, leadColumns } from '@/ui/data';

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

type Row = CustomerMaterialReturn;

export function cmrColumns(firstRowNo: number): DataTableColumn<Row>[] {
  return [
    ...leadColumns<Row>({
      firstRowNo,
      doc: {
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
      // ADR-307 — one order column: SO No. of an Equipment SO return, else the
      // JWSO No. (NAMING.md: a list carrying both keeps the heading SO No.).
      so: 'so',
      soNo: (r) => r.soCode ?? r.jwCode,
      createdOn: (r) => r.createdAt,
      overrides: {
        so_no: { sortFilterField: 'jwCode' },
        created_on: { sortFilterField: 'createdOn' },
      },
    }),
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
      id: 'kind',
      sortFilterField: 'kind',
      filterType: 'list',
      filterOptions: KIND_OPTIONS,
      kind: 'badge',
      header: 'Return Kind',
      nowrap: true,
      render: (r) =>
        r.firstKind ? (
          <>
            <span className={`badge ${r.firstKind === 'rejected' ? 'b-red' : 'b-green'}`}>
              {CMR_KIND_LABEL[r.firstKind]}
            </span>
            {r.kindExtraCount ? <span className="text3"> +{r.kindExtraCount}</span> : null}
          </>
        ) : (
          '—'
        ),
    },
    {
      id: 'line_count',
      sortFilterField: 'lineCount',
      kind: 'num',
      header: 'Lines',
      className: 'mono',
      nowrap: true,
      render: (r) => r.lineCount ?? 0,
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
    // ADR-261 rev — Created By, the last data column.
    createdByColumn({
      createdByName: (r) => r.createdByName,
      overrides: { sortFilterField: 'createdBy' },
    }),
  ];
}
