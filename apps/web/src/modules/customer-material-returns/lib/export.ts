// ADR-310 — Customer Material Return's shared Export (copies the JWSO pilot).
//
// Sheet 1 "Customer Material Return": the list's own columns as shown.
// Sheet 2 "Customer Material Return Lines": GET /customer-material-returns/lines
// WITHOUT the search (a search on one code would drop the return's other
// lines), then kept to the returns on sheet 1. No money on these lines.

import type { CustomerMaterialReturn, CustomerMaterialReturnLineRow } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { statusText } from '@/lib/status-text';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchCustomerMaterialReturnLinesPage, fetchCustomerMaterialReturnsPage } from '../api';
import { CMR_KIND_LABEL } from '../components/cmr-columns';

export const CMR_LINES_HEADER = [
  'Return No.',
  'JWSO No.',
  'POL',
  'Return Date',
  'Item Code',
  'Item Name',
  'Customer RM',
  'Party GRN No.',
  'Return Kind',
  'Return Qty',
  'Customer',
  'Return Status',
];

export function cmrLineExportRow(l: CustomerMaterialReturnLineRow): (string | number | null)[] {
  return [
    l.docCode,
    l.jwCode ?? l.soCode ?? null,
    l.clientPoLineNo ?? null,
    fmtDate(l.docDate, '') || null,
    itemCodeWithRev(l.itemCode, l.itemRevision, '') || null,
    l.itemName ?? null,
    l.rmItemCode ?? null,
    l.partyGrnCode ?? null,
    CMR_KIND_LABEL[l.kind],
    l.qty,
    l.clientName ?? null,
    statusText(l.docStatus),
  ];
}

export interface CmrExportArgs {
  columns: DataTableColumn<CustomerMaterialReturn>[];
  tableKey: string;
  search: string | undefined;
  sfParam: string | undefined;
  hideMoney: boolean;
}

export function cmrExportSpec(
  a: CmrExportArgs,
): ListExportSpec<CustomerMaterialReturn, CustomerMaterialReturnLineRow> {
  const words = [
    a.search ? `search "${a.search}"` : null,
    a.sfParam ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  return {
    fileName: 'Customer Material Return',
    tableKey: a.tableKey,
    columns: a.columns,
    rowKey: (r) => r.id,
    hideMoney: a.hideMoney,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: (limit, offset) =>
      fetchCustomerMaterialReturnsPage({
        ...(a.search ? { search: a.search } : {}),
        ...(a.sfParam ? { sf: a.sfParam } : {}),
        limit,
        offset,
      }),
    linesSheet: {
      name: 'Customer Material Return Lines',
      header: CMR_LINES_HEADER,
      fetchPage: (limit, offset) => fetchCustomerMaterialReturnLinesPage({ limit, offset }),
      docKey: (r) => r.id,
      lineDocKey: (l) => l.docId,
      toRow: cmrLineExportRow,
    },
  };
}
