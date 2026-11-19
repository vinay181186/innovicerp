// ADR-310 — Item Issue Register's shared Export (copies the JWSO Master pilot).
//
// Sheet 1 "Item Issue Register": the list's own columns as the user sees them.
// Sheet 2 "Item Issue Lines": GET /store-issues/lines WITHOUT the search (a
// search on one item code would drop the slip's other lines), then kept to the
// slips on sheet 1. No money on an issue line.

import type { StoreIssueLineRow, StoreIssueListItem } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchStoreIssueLinesPage, fetchStoreIssuesPage } from '../api';

export const ISSUE_LINES_HEADER = [
  'Issue No.',
  'POL',
  'Issue Date',
  'Item Code',
  'Item Name',
  'UOM',
  'Issue Qty',
  'Issued To',
  'Purpose',
  'Issue Status',
];

export function issueLineExportRow(l: StoreIssueLineRow): (string | number | null)[] {
  return [
    l.docCode,
    l.clientPoLineNo ?? null,
    fmtDate(l.docDate, '') || null,
    itemCodeWithRev(l.itemCode, l.itemRevision, '') || null,
    l.itemName ?? null,
    l.uom ?? null,
    l.qty,
    l.issuedTo || null,
    l.purpose ?? null,
    l.reversedAt ? 'Reversed' : 'Issued',
  ];
}

export interface IssueExportArgs {
  columns: DataTableColumn<StoreIssueListItem>[];
  tableKey: string;
  search: string | undefined;
  sfParam: string | undefined;
  hideMoney: boolean;
}

export function issueExportSpec(
  a: IssueExportArgs,
): ListExportSpec<StoreIssueListItem, StoreIssueLineRow> {
  const words = [
    a.search ? `search "${a.search}"` : null,
    a.sfParam ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  return {
    fileName: 'Item Issue Register',
    tableKey: a.tableKey,
    columns: a.columns,
    rowKey: (r) => r.id,
    hideMoney: a.hideMoney,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: (limit, offset) =>
      fetchStoreIssuesPage({ search: a.search, sf: a.sfParam, limit, offset }),
    linesSheet: {
      name: 'Item Issue Lines',
      header: ISSUE_LINES_HEADER,
      fetchPage: (limit, offset) => fetchStoreIssueLinesPage({ limit, offset }),
      docKey: (r) => r.id,
      lineDocKey: (l) => l.docId,
      toRow: issueLineExportRow,
    },
  };
}
