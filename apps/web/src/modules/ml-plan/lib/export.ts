// ADR-310 — the Multi-Level Plan list's shared Export (copies the JWSO pilot).
//
// One sheet: the list's own columns as the user sees them. Every cell reads
// as plain words already (the status chip words itself), so no exportValue.
// There is no Lines sheet: the API has no per-line Multi-Level Plan list.

import type { MlPlanListItem } from '@innovic/shared';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchMlPlansPage } from '../api';

export interface MlPlanExportArgs {
  columns: DataTableColumn<MlPlanListItem>[];
  tableKey: string;
  search: string | undefined;
  sfParam: string | undefined;
}

export function mlPlanExportSpec(a: MlPlanExportArgs): ListExportSpec<MlPlanListItem> {
  const words = [
    a.search ? `search "${a.search}"` : null,
    a.sfParam ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  return {
    fileName: 'Multi-Level Plan',
    tableKey: a.tableKey,
    columns: a.columns,
    rowKey: (p) => p.id,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: (limit, offset) =>
      fetchMlPlansPage({ search: a.search, sf: a.sfParam, limit, offset }),
  };
}
