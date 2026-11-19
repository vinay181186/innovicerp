// ADR-310 — the QC Documents screen's shared Export (copies the JWSO pilot).
//
// Register tab: one sheet, every document matching the Category, search and
// column sort / filter, fetched page by page. SO Status tab: the lines of the
// ONE chosen SO are already in the browser, so they go as they are; the
// stage list, the pills and the progress bar are components, so they get
// plain words. No money on either tab.

import type { ListQcDocumentsQuery, QcDocument, SoQcLine } from '@innovic/shared';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchQcDocumentsPage } from '../api';

export interface QcRegisterExportArgs {
  columns: DataTableColumn<QcDocument>[];
  tableKey: string;
  defaultHidden: string[];
  category: ListQcDocumentsQuery['category'];
  categoryLabel: string | undefined;
  search: string | undefined;
  sfParam: string | undefined;
}

export function qcRegisterExportSpec(a: QcRegisterExportArgs): ListExportSpec<QcDocument> {
  const words = [
    a.categoryLabel ? `category ${a.categoryLabel}` : null,
    a.search ? `search "${a.search}"` : null,
    a.sfParam ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  const base: Omit<ListQcDocumentsQuery, 'limit' | 'offset'> = {
    ...(a.category ? { category: a.category } : {}),
    ...(a.search ? { search: a.search } : {}),
    ...(a.sfParam ? { sf: a.sfParam } : {}),
  };
  return {
    fileName: 'QC Documents',
    tableKey: a.tableKey,
    columns: a.columns,
    defaultHidden: a.defaultHidden,
    rowKey: (r) => r.id,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: (limit, offset) => fetchQcDocumentsPage({ ...base, limit, offset }),
  };
}

const pill = (l: SoQcLine, done: number, total: number): string =>
  !l.hasAnyQc || total === 0 ? '—' : `${done}/${total}`;

function stagesText(l: SoQcLine): string {
  if (!l.hasAnyQc) return 'No QC stage defined for this line';
  if (l.jcQc.length === 0) return '—';
  return l.jcQc
    .map(
      (jd) =>
        `${jd.jcCode}: ${jd.ops
          .map((op) => `${op.operation} ${op.accepted}/${op.orderQty} (${op.status})`)
          .join(', ')}`,
    )
    .join('; ');
}

/** Plain words for the SO Status cells that draw components. */
export function withSoStatusExportValues(
  columns: DataTableColumn<SoQcLine>[],
): DataTableColumn<SoQcLine>[] {
  return columns.map((c) => {
    if (c.id === 'qc_stages') return { ...c, exportValue: stagesText };
    if (c.id === 'incoming_qc')
      return { ...c, exportValue: (l: SoQcLine) => pill(l, l.grnDone, l.grnTotal) };
    if (c.id === 'docs')
      return { ...c, exportValue: (l: SoQcLine) => pill(l, l.docUploaded, l.docCount) };
    if (c.id === 'overall')
      return { ...c, exportValue: (l: SoQcLine) => (l.hasAnyQc ? `${l.overallPct}%` : 'N/A') };
    return c;
  });
}

export function soStatusExportSpec(a: {
  columns: DataTableColumn<SoQcLine>[];
  tableKey: string;
  defaultHidden: string[];
  soCode: string;
  rows: SoQcLine[];
}): ListExportSpec<SoQcLine> {
  return {
    fileName: 'QC Documents SO Status',
    tableKey: a.tableKey,
    columns: a.columns,
    defaultHidden: a.defaultHidden,
    rows: a.rows,
    rowKey: (l) => l.soLineId,
    filterSummary: `SO ${a.soCode}`,
  };
}
