// ADR-310 — Purchase Orders' shared Export (copies the JWSO Master pilot).
//
// Sheet 1 "Purchase Orders": the list's own columns as the user sees them.
// Sheet 2 "PO Lines": GET /purchase-orders/lines with the PO status only (NOT
// the search — a search on an item code would drop the PO's other lines),
// then kept to the POs on sheet 1. Rate / Amount are left out for a
// no-price user, header and row alike.

import type {
  ListPurchaseOrdersQuery,
  PurchaseOrderLineListItem,
  PurchaseOrderListItem,
} from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchPurchaseOrderLinesPage, fetchPurchaseOrdersPage } from '../api';
import { PO_STATUS_LABELS, PO_TYPE_LABELS } from './po-labels';

const LINE_HEADER = [
  'PO No.',
  'POL',
  'PO Date',
  'Item Code',
  'Item Name',
  'Vendor',
  'PO Qty',
  'GRN Received',
  'Accepted',
  'Pending',
];
const MONEY_HEADER = ['Rate', 'Amount'];

export function poLinesHeader(hideMoney: boolean): string[] {
  return hideMoney ? LINE_HEADER : [...LINE_HEADER, ...MONEY_HEADER];
}

export function poLineExportRow(
  l: PurchaseOrderLineListItem,
  hideMoney: boolean,
): (string | number | null)[] {
  const row: (string | number | null)[] = [
    l.docCode,
    l.clientPoLineNo ?? null,
    fmtDate(l.docDate, '') || null,
    itemCodeWithRev(l.itemCode, l.itemRevision, '') || null,
    l.itemName ?? null,
    l.vendorName ?? l.vendorCodeText ?? null,
    l.qty,
    l.grnReceivedQty,
    l.qcAcceptedQty,
    l.pendingQty,
  ];
  return hideMoney ? row : [...row, l.rate ?? null, l.amount ?? null];
}

/** exportValue for the PO columns whose shown text is a component or decorated. */
function withPoExportValues(
  columns: DataTableColumn<PurchaseOrderListItem>[],
  draftIds: Set<string> | undefined,
): DataTableColumn<PurchaseOrderListItem>[] {
  const values: Record<string, (po: PurchaseOrderListItem) => string | number | null> = {
    po_status: (po) => (draftIds?.has(po.id) ? 'Draft' : PO_STATUS_LABELS[po.status]),
    total_value_basic: (po) => po.subtotal ?? null,
  };
  return columns.map((c) => {
    const fn = c.id ? values[c.id] : undefined;
    return fn ? { ...c, exportValue: fn } : c;
  });
}

export interface PoExportArgs {
  columns: DataTableColumn<PurchaseOrderListItem>[];
  draftIds: Set<string> | undefined;
  tableKey: string;
  search: string | undefined;
  status: ListPurchaseOrdersQuery['status'];
  poType: ListPurchaseOrdersQuery['poType'];
  sfParam: string | undefined;
  hideMoney: boolean;
}

export function poExportSpec(
  a: PoExportArgs,
): ListExportSpec<PurchaseOrderListItem, PurchaseOrderLineListItem> {
  const words = [
    a.search ? `search "${a.search}"` : null,
    a.status ? `PO Status ${PO_STATUS_LABELS[a.status]}` : null,
    a.poType ? `PO Type ${PO_TYPE_LABELS[a.poType]}` : null,
    a.sfParam ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  return {
    fileName: 'Purchase Orders',
    tableKey: a.tableKey,
    columns: withPoExportValues(a.columns, a.draftIds),
    rowKey: (po) => po.id,
    hideMoney: a.hideMoney,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: (limit, offset) =>
      fetchPurchaseOrdersPage({
        search: a.search,
        status: a.status,
        poType: a.poType,
        sf: a.sfParam,
        limit,
        offset,
      }),
    linesSheet: {
      name: 'PO Lines',
      header: poLinesHeader(a.hideMoney),
      fetchPage: (limit, offset) =>
        fetchPurchaseOrderLinesPage({ status: a.status, limit, offset }),
      docKey: (po) => po.id,
      lineDocKey: (l) => l.docId,
      lineOrder: (l) => l.lineNo,
      toRow: (l) => poLineExportRow(l, a.hideMoney),
    },
  };
}
