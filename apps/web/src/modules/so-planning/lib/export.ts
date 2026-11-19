// ADR-310 — the SO/JWSO Planning list's shared Export (copies the JWSO pilot).
//
// One sheet "SO/JWSO Planning": the Level-1 line list's own columns as the
// user sees them, every open line matching Order source, search, the Home
// "Party GRN plan pending" filter and the column sort / filter. The SO No.
// cell carries a JW chip component, so it gets the plain SO No. No money.

import type { PlanningLineListItem, PlanningLineListQuery } from '@innovic/shared';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchPlanningLinePage } from '../api';

export function withPlanningLineExportValues(
  columns: DataTableColumn<PlanningLineListItem>[],
): DataTableColumn<PlanningLineListItem>[] {
  return columns.map((c) =>
    c.id === 'so_no' ? { ...c, exportValue: (r: PlanningLineListItem) => r.soCode } : c,
  );
}

export interface PlanningLineExportArgs {
  columns: DataTableColumn<PlanningLineListItem>[];
  tableKey: string;
  query: Omit<PlanningLineListQuery, 'limit' | 'offset'>;
  sourceLabel: string | undefined;
}

export function planningLineExportSpec(
  a: PlanningLineExportArgs,
): ListExportSpec<PlanningLineListItem> {
  const q = a.query;
  const words = [
    a.sourceLabel ? `source ${a.sourceLabel}` : null,
    q.grnPlanPending ? 'Party GRN plan pending' : null,
    q.search ? `search "${q.search}"` : null,
    q.sf ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  return {
    fileName: 'SO/JWSO Planning',
    tableKey: a.tableKey,
    columns: a.columns,
    rowKey: (r) => r.soLineId,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: (limit, offset) => fetchPlanningLinePage({ ...q, limit, offset }),
  };
}
