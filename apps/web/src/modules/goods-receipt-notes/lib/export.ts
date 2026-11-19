// ADR-310 — GRN's shared Export (copies the JWSO Master pilot).
//
// Sheet 1 "GRN": the list's own columns as the user sees them.
// Sheet 2 "GRN Lines": GET /goods-receipt-notes/lines with the document QC
// status only (NOT the search, NOT the line-level QC filter — either would drop
// a GRN's other lines), Cancelled GRNs included as on the list, then kept to
// the GRNs on sheet 1. No money on a GRN line.

import type {
  GoodsReceiptNoteLineListItem,
  GoodsReceiptNoteListItem,
  ListGoodsReceiptNotesQuery,
} from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { statusText } from '@/lib/status-text';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchGoodsReceiptNoteLinesPage, fetchGoodsReceiptNotesPage } from '../api';
import { DOC_QC_LABELS } from '../components/doc-qc-badge';
import { isGrnCancelled } from '../components/grn-list-columns';

export const GRN_LINES_HEADER = [
  'GRN No.',
  'POL',
  'GRN Date',
  'Item Code',
  'Item Name',
  'Vendor',
  'PO/NC No.',
  'Received',
  'Accepted',
  'Rejected',
  'QC Status',
];

export function grnLineExportRow(l: GoodsReceiptNoteLineListItem): (string | number | null)[] {
  const ref = l.ncId ? (l.ncCode ?? l.poCodeText) : (l.poCode ?? l.poCodeText);
  return [
    l.docCode,
    l.clientPoLineNo ?? null,
    fmtDate(l.docDate, '') || null,
    itemCodeWithRev(l.itemCode, l.itemRevision, '') || null,
    l.itemName ?? null,
    l.vendorName ?? l.vendorCodeText ?? null,
    ref ?? null,
    l.receivedQty,
    l.qcAcceptedQty,
    l.qcRejectedQty,
    l.cancelledAt ? 'Cancelled' : statusText(l.lineQcStatus),
  ];
}

export interface GrnExportArgs {
  columns: DataTableColumn<GoodsReceiptNoteListItem>[];
  draftIds: Set<string> | undefined;
  tableKey: string;
  search: string | undefined;
  qcStatus: ListGoodsReceiptNotesQuery['qcStatus'];
  docQcStatus: ListGoodsReceiptNotesQuery['docQcStatus'];
  sfParam: string | undefined;
  hideMoney: boolean;
}

export function grnExportSpec(
  a: GrnExportArgs,
): ListExportSpec<GoodsReceiptNoteListItem, GoodsReceiptNoteLineListItem> {
  const values: Record<string, (g: GoodsReceiptNoteListItem) => string | number | null> = {
    // <DocQcBadge> is a component element: its word is not in the tree.
    qc_status: (g) =>
      isGrnCancelled(g)
        ? 'Cancelled'
        : a.draftIds?.has(g.id)
          ? 'Draft'
          : g.docQcStatus
            ? DOC_QC_LABELS[g.docQcStatus]
            : null,
  };
  const words = [
    a.search ? `search "${a.search}"` : null,
    a.qcStatus ? `QC status ${statusText(String(a.qcStatus))}` : null,
    a.docQcStatus ? `QC Status ${statusText(String(a.docQcStatus))}` : null,
    a.sfParam ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  return {
    fileName: 'GRN',
    tableKey: a.tableKey,
    columns: a.columns.map((c) => {
      const fn = c.id ? values[c.id] : undefined;
      return fn ? { ...c, exportValue: fn } : c;
    }),
    rowKey: (g) => g.id,
    hideMoney: a.hideMoney,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: (limit, offset) =>
      fetchGoodsReceiptNotesPage({
        search: a.search,
        qcStatus: a.qcStatus,
        docQcStatus: a.docQcStatus,
        sf: a.sfParam,
        includeCancelled: true,
        limit,
        offset,
      }),
    linesSheet: {
      name: 'GRN Lines',
      header: GRN_LINES_HEADER,
      fetchPage: (limit, offset) =>
        fetchGoodsReceiptNoteLinesPage({
          docQcStatus: a.docQcStatus,
          includeCancelled: true,
          limit,
          offset,
        }),
      docKey: (g) => g.id,
      lineDocKey: (l) => l.docId,
      lineOrder: (l) => l.lineNo,
      toRow: grnLineExportRow,
    },
  };
}
