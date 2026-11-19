// ADR-310 — OSP Outward DC's shared Export (copy of the JWSO Master pilot,
// job-work-orders/lib/export-lines.ts).
//
// Sheet 1 "OSP Outward DC": the list's own columns as the user sees them. The
// PO No. cell (<PoCell>) and DC Status cell (<DcStatusBadge>) are components
// whose words are not in the tree, so they get an `exportValue`.
// Sheet 2 "DC Lines": GET /delivery-challans/lines with the same DC Status only
// (NOT the search — a search on an item code would drop the DC's other lines,
// and NOT `sf` — the lines endpoint has its own column map); the shared hook
// keeps them to the DCs on sheet 1. A DC carries no money.

import type { DcStatus, DeliveryChallanListItem, DeliveryChallanListLine } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchDeliveryChallanLinesPage, fetchDeliveryChallansPage } from '../api';
import { DC_STATUS_LABEL } from './dc-status-label';

/** Line-sheet headings — docs/NAMING.md names. */
export const DC_LINES_HEADER = [
  'DC No.',
  'DC Date',
  'SO No.',
  'Internal SO No.',
  'POL',
  'Item Code',
  'Item Name',
  'Vendor',
  'PO No.',
  'JC No.',
  'Sent Qty',
  'UOM',
  'DC Status',
];

/** What the PO No. cell shows, in words. */
function poWords(p: {
  ncId: string | null;
  ncCode: string | null;
  poCode: string | null;
  poCodeText: string;
}): string | null {
  if (p.ncId) return `NC ${p.ncCode ?? p.poCodeText}`;
  return p.poCode ?? (p.poCodeText || null);
}

export function dcLineExportRow(l: DeliveryChallanListLine): (string | number | null)[] {
  const qty = Number(l.qty);
  return [
    l.docCode,
    fmtDate(l.docDate, '') || null,
    l.soCode ?? l.jwCode ?? null,
    l.soInternalNo ?? null,
    l.clientPoLineNo ?? null,
    itemCodeWithRev(l.itemCode, l.itemRevision, '') || null,
    l.itemName ?? null,
    l.vendorName ?? (l.vendorCodeText || null),
    poWords(l),
    l.jobCardCode ?? null,
    Number.isFinite(qty) ? qty : l.qty,
    l.uom,
    DC_STATUS_LABEL[l.docStatus],
  ];
}

/** exportValue for the DC columns whose shown text is a component. */
export function withDcExportValues(
  columns: DataTableColumn<DeliveryChallanListItem>[],
  draftIds?: Set<string>,
): DataTableColumn<DeliveryChallanListItem>[] {
  const values: Record<string, (dc: DeliveryChallanListItem) => string | number | null> = {
    po_code: (dc) =>
      dc.ncId && dc.ncs.length > 0 ? `NC ${dc.ncs.map((n) => n.code).join(', ')}` : poWords(dc),
    dc_status: (dc) => (draftIds?.has(dc.id) ? 'Draft' : DC_STATUS_LABEL[dc.status]),
  };
  return columns.map((c) => {
    const fn = c.id ? values[c.id] : undefined;
    return fn ? { ...c, exportValue: fn } : c;
  });
}

export interface DcExportArgs {
  columns: DataTableColumn<DeliveryChallanListItem>[];
  tableKey: string;
  search: string | undefined;
  status: DcStatus | undefined;
  sfParam: string | undefined;
  hideMoney: boolean;
}

export function dcExportSpec(
  a: DcExportArgs,
): ListExportSpec<DeliveryChallanListItem, DeliveryChallanListLine> {
  const words = [
    a.search ? `search "${a.search}"` : null,
    a.status ? `DC Status ${DC_STATUS_LABEL[a.status]}` : null,
    a.sfParam ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  return {
    fileName: 'OSP Outward DC',
    tableKey: a.tableKey,
    columns: a.columns,
    rowKey: (dc) => dc.id,
    hideMoney: a.hideMoney,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: (limit, offset) =>
      fetchDeliveryChallansPage({
        search: a.search,
        status: a.status,
        sf: a.sfParam,
        limit,
        offset,
      }),
    linesSheet: {
      name: 'DC Lines',
      header: DC_LINES_HEADER,
      fetchPage: (limit, offset) =>
        fetchDeliveryChallanLinesPage({ status: a.status, limit, offset }),
      docKey: (dc) => dc.id,
      lineDocKey: (l) => l.docId,
      lineOrder: (l) => l.lineNo,
      toRow: dcLineExportRow,
    },
  };
}
