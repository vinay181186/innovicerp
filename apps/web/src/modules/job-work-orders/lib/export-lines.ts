// ADR-310 pilot — JWSO Master's shared Export.
//
// Sheet 1 "JWSO Master": the list's own columns as the user sees them (the
// shared ListExportButton reads them). Columns whose cell text the export
// cannot read (a component cell, a ⚠ suffix) get an `exportValue` here.
// Sheet 2 "JWSO Lines": GET /job-work-orders/lines with the same JWSO status
// only (NOT the search — a search on a part code would drop the JWSO's other
// lines), then kept to the JWSOs on sheet 1, so it holds every line of exactly
// those JWSOs. The lines endpoint has its OWN Sort &
// Filter column map (JWSO_LINE_SF_COLUMNS), so the list's `sf` is not sent;
// the doc filter in the shared hook keeps the lines to sheet-1 JWSOs instead.

import {
  CUSTOMER_RM_STATUS_LABEL,
  type CustomerRm,
  type JobWorkOrderLineListRow,
  type JobWorkOrderListItem,
  type ListJobWorkOrdersQuery,
} from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { SO_STATUS_LABEL } from '@/modules/sales-orders/lib/so-status-label';
import { fetchJobWorkOrderLinesPage, fetchJobWorkOrdersPage } from '../api';

/** Line-sheet headings — docs/NAMING.md names. */
export const JWSO_LINES_HEADER = [
  'JWSO No.',
  'POL',
  'Created On',
  'Item Code',
  'Item Name',
  'Customer RM',
  'Customer',
  'Client PO No.',
  'Order Qty',
  'Dispatched',
  'Pending',
  'Due Date',
  'Customer RM Status',
];

function rmWord(v: CustomerRm | undefined): string | null {
  return !v || v.status === 'none' ? null : CUSTOMER_RM_STATUS_LABEL[v.status];
}

/** Pieces still owed on a line: 0 once closed short or cancelled (as on SO). */
export function jwLinePendingQty(l: JobWorkOrderLineListRow): number {
  if (l.lineShortClosedAt || l.lineStatus === 'cancelled') return 0;
  return Math.max(0, l.orderQty - l.dispatchedQty);
}

export function jwsoLineExportRow(l: JobWorkOrderLineListRow): (string | number | null)[] {
  return [
    l.docCode,
    l.clientPoLineNo ?? null,
    fmtDate(l.createdAt, '') || null,
    itemCodeWithRev(l.itemCode, l.itemRevision, '') || null,
    l.itemName ?? null,
    l.rmItemCode ?? null,
    l.customerName ?? null,
    l.clientPoNo ?? null,
    l.orderQty,
    l.dispatchedQty,
    jwLinePendingQty(l),
    fmtDate(l.dueDate, '') || null,
    rmWord(l.customerRm),
  ];
}

/** exportValue for the JWSO columns whose shown text is blank or decorated. */
export function withJwsoExportValues(
  columns: DataTableColumn<JobWorkOrderListItem>[],
  draftIds?: Set<string>,
): DataTableColumn<JobWorkOrderListItem>[] {
  const values: Record<string, (jw: JobWorkOrderListItem) => string | number | null> = {
    // <CustomerRmStatus> is a component element: its word is not in the tree.
    customer_material: (jw) => rmWord(jw.customerRm),
    // The cell adds " ⚠" when overdue.
    due: (jw) => fmtDate(jw.earliestDueDate, '') || null,
    jwso_status: (jw) => (draftIds?.has(jw.jwId) ? 'Draft' : SO_STATUS_LABEL[jw.status]),
    customer: (jw) => jw.customerName ?? null,
  };
  return columns.map((c) => {
    const fn = c.id ? values[c.id] : undefined;
    return fn ? { ...c, exportValue: fn } : c;
  });
}

export interface JwsoExportArgs {
  columns: DataTableColumn<JobWorkOrderListItem>[];
  tableKey: string;
  search: string | undefined;
  status: ListJobWorkOrdersQuery['status'];
  sfParam: string | undefined;
  hideMoney: boolean;
}

export function jwsoExportSpec(
  a: JwsoExportArgs,
): ListExportSpec<JobWorkOrderListItem, JobWorkOrderLineListRow> {
  const base = { search: a.search, status: a.status };
  const words = [
    a.search ? `search "${a.search}"` : null,
    a.status ? `JWSO Status ${SO_STATUS_LABEL[a.status]}` : null,
    a.sfParam ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  return {
    fileName: 'JWSO Master',
    tableKey: a.tableKey,
    columns: a.columns,
    rowKey: (jw) => jw.jwId,
    hideMoney: a.hideMoney,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: (limit, offset) => fetchJobWorkOrdersPage({ ...base, sf: a.sfParam, limit, offset }),
    linesSheet: {
      name: 'JWSO Lines',
      header: JWSO_LINES_HEADER,
      fetchPage: (limit, offset) => fetchJobWorkOrderLinesPage({ status: a.status, limit, offset }),
      docKey: (jw) => jw.jwId,
      lineDocKey: (l) => l.docId,
      lineOrder: (l) => l.lineNo,
      toRow: jwsoLineExportRow,
    },
  };
}
