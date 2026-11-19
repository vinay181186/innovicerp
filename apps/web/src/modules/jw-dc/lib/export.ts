// ADR-310 — the JW DC Outward / Inward Registers' shared Export (copy of the
// JWSO Master pilot, job-work-orders/lib/export-lines.ts).
//
// Sheet 1: the register's own columns as the user sees them (their cells are
// plain spans the export reads). Deviated draws "—" for 0, so it gets a number
// `exportValue`. Sheet 2: GET /jw-dc/{outward|inward}/lines with only
// includeCancelled (the registers list Cancelled documents too) — NOT the
// search (it would drop a document's other lines) and NOT `sf` (the lines
// endpoints have their own column maps); the shared hook keeps the lines to
// the documents on sheet 1. A JW DC carries no money.

import type {
  JwDcInwardLineRow,
  JwDcInwardListItem,
  JwDcOutwardLineRow,
  JwDcOutwardListItem,
} from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import {
  fetchJwDcInwardLinesPage,
  fetchJwDcInwardPage,
  fetchJwDcOutwardLinesPage,
  fetchJwDcOutwardPage,
} from '../api';

type Cell = string | number | null;

export interface JwDcExportArgs<T> {
  columns: DataTableColumn<T>[];
  tableKey: string;
  search: string | undefined;
  sfParam: string | undefined;
  hideMoney: boolean;
}

function summary(search: string | undefined, sfParam: string | undefined): string | undefined {
  const words = [
    search ? `search "${search}"` : null,
    sfParam ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  return words.join(' · ') || undefined;
}

/** The lead facts every JW DC line row carries. */
function leadCells(l: JwDcOutwardLineRow | JwDcInwardLineRow): Cell[] {
  return [
    l.docCode,
    fmtDate(l.docDate, '') || null,
    l.soCode ?? l.jwCode ?? null,
    l.soInternalNo ?? null,
    l.clientPoLineNo ?? null,
    itemCodeWithRev(l.itemCode, l.itemRevision, '') || null,
    l.itemName ?? null,
    l.vendorName ?? null,
    l.jwpoCodeText ?? null,
  ];
}

const LEAD_HEADS = [
  'SO No.',
  'Internal SO No.',
  'POL',
  'Item Code',
  'Item Name',
  'Vendor',
  'PO No.',
];

const RETURN_WORD = { out: 'At Vendor', partial: 'Partly Returned', fully_returned: 'Returned' };

export const JW_OUTWARD_LINES_HEADER = [
  'DC No.',
  'DC Date',
  ...LEAD_HEADS,
  'Sent',
  'Received',
  'Pending',
  'DC Status',
];

export function jwOutwardLineExportRow(l: JwDcOutwardLineRow): Cell[] {
  return [
    ...leadCells(l),
    l.sentQty,
    l.receivedQty,
    l.pendingQty,
    l.cancelledAt ? 'Cancelled' : RETURN_WORD[l.returnStatus],
  ];
}

export const JW_INWARD_LINES_HEADER = [
  'Inward No.',
  'Inward Date',
  ...LEAD_HEADS,
  'DC No.',
  'Received',
  'Accepted',
  'Deviated',
];

export function jwInwardLineExportRow(l: JwDcInwardLineRow): Cell[] {
  const cells = leadCells(l);
  if (l.cancelledAt) cells[0] = `${l.docCode} (Cancelled)`;
  return [...cells, l.dcCodeText ?? null, l.receivedQty, l.okQty, l.rejectedQty];
}

/** Both registers list Cancelled documents too (as on screen). */
const docQuery = <T>(a: JwDcExportArgs<T>, limit: number, offset: number) => ({
  search: a.search,
  sf: a.sfParam,
  includeCancelled: true,
  limit,
  offset,
});
const lineQuery = (limit: number, offset: number) => ({ includeCancelled: true, limit, offset });

export function jwOutwardExportSpec(
  a: JwDcExportArgs<JwDcOutwardListItem>,
): ListExportSpec<JwDcOutwardListItem, JwDcOutwardLineRow> {
  return {
    fileName: 'Outward Register',
    tableKey: a.tableKey,
    columns: a.columns,
    rowKey: (dc) => dc.id,
    hideMoney: a.hideMoney,
    filterSummary: summary(a.search, a.sfParam),
    fetchPage: (limit, offset) => fetchJwDcOutwardPage(docQuery(a, limit, offset)),
    linesSheet: {
      name: 'Outward DC Lines',
      header: JW_OUTWARD_LINES_HEADER,
      fetchPage: (limit, offset) => fetchJwDcOutwardLinesPage(lineQuery(limit, offset)),
      docKey: (dc) => dc.id,
      lineDocKey: (l) => l.docId,
      toRow: jwOutwardLineExportRow,
    },
  };
}

/** Deviated draws "—" for 0 on screen; the file gets the number. */
export function withInwardExportValues(
  columns: DataTableColumn<JwDcInwardListItem>[],
): DataTableColumn<JwDcInwardListItem>[] {
  return columns.map((c) =>
    c.id === 'rejected' ? { ...c, exportValue: (r: JwDcInwardListItem) => r.totalRejectedQty } : c,
  );
}

export function jwInwardExportSpec(
  a: JwDcExportArgs<JwDcInwardListItem>,
): ListExportSpec<JwDcInwardListItem, JwDcInwardLineRow> {
  return {
    fileName: 'Inward Register',
    tableKey: a.tableKey,
    columns: a.columns,
    rowKey: (inv) => inv.id,
    hideMoney: a.hideMoney,
    filterSummary: summary(a.search, a.sfParam),
    fetchPage: (limit, offset) => fetchJwDcInwardPage(docQuery(a, limit, offset)),
    linesSheet: {
      name: 'Inward Lines',
      header: JW_INWARD_LINES_HEADER,
      fetchPage: (limit, offset) => fetchJwDcInwardLinesPage(lineQuery(limit, offset)),
      docKey: (inv) => inv.id,
      lineDocKey: (l) => l.docId,
      toRow: jwInwardLineExportRow,
    },
  };
}
