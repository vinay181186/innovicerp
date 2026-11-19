// ADR-310 — Party GRN's shared Export (copies the JWSO Master pilot).
//
// Sheet 1 "Party GRN": the list's own columns as the user sees them.
// Sheet 2 "Party GRN Lines": GET /party-grn/lines, Cancelled GRNs included as
// on the list, WITHOUT the search (a search on one code would drop the GRN's
// other lines), then kept to the GRNs on sheet 1. No money on these lines.

import type { PartyGrnLineListRow, PartyGrnListItem } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { DOC_QC_LABELS } from '@/modules/goods-receipt-notes/components/doc-qc-badge';
import { fetchPartyGrnLinesPage, fetchPartyGrnPage } from '../api';
import { isPartyGrnCancelled } from '../components/party-grn-columns';

export const PARTY_GRN_LINES_HEADER = [
  'Party GRN No.',
  'JWSO No.',
  'POL',
  'GRN Date',
  'Customer RM',
  'Item Name',
  'Customer',
  'Client PO No.',
  'Customer Challan No.',
  'Received',
  'Accepted',
  'Rejected',
  'QC Pending',
];

export function partyGrnLineExportRow(l: PartyGrnLineListRow): (string | number | null)[] {
  return [
    l.docCode,
    l.jwCode ?? l.soCode ?? null,
    l.clientPoLineNo ?? null,
    fmtDate(l.docDate, '') || null,
    itemCodeWithRev(l.itemCode, l.itemRevision, '') || null,
    l.itemName ?? null,
    l.customerName ?? null,
    l.clientPoNo ?? null,
    l.dcNo ?? null,
    l.receivedQty,
    l.acceptedQty,
    l.rejectedQty,
    l.qcPendingQty,
  ];
}

export interface PartyGrnExportArgs {
  columns: DataTableColumn<PartyGrnListItem>[];
  tableKey: string;
  search: string | undefined;
  sfParam: string | undefined;
  hideMoney: boolean;
}

export function partyGrnExportSpec(
  a: PartyGrnExportArgs,
): ListExportSpec<PartyGrnListItem, PartyGrnLineListRow> {
  const values: Record<string, (g: PartyGrnListItem) => string | number | null> = {
    // <DocQcBadge> is a component element: its word is not in the tree.
    qc_status: (g) =>
      isPartyGrnCancelled(g) ? 'Cancelled' : g.docQcStatus ? DOC_QC_LABELS[g.docQcStatus] : null,
  };
  const words = [
    a.search ? `search "${a.search}"` : null,
    a.sfParam ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  return {
    fileName: 'Party GRN',
    tableKey: a.tableKey,
    columns: a.columns.map((c) => {
      const fn = c.id ? values[c.id] : undefined;
      return fn ? { ...c, exportValue: fn } : c;
    }),
    rowKey: (g) => g.id,
    hideMoney: a.hideMoney,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: (limit, offset) =>
      fetchPartyGrnPage({
        search: a.search,
        sf: a.sfParam,
        includeCancelled: true,
        limit,
        offset,
      }),
    linesSheet: {
      name: 'Party GRN Lines',
      header: PARTY_GRN_LINES_HEADER,
      fetchPage: (limit, offset) =>
        fetchPartyGrnLinesPage({ includeCancelled: true, limit, offset }),
      docKey: (g) => g.id,
      lineDocKey: (l) => l.docId,
      lineOrder: (l) => l.lineNo,
      toRow: partyGrnLineExportRow,
    },
  };
}
