// ADR-310 — the Saved Reports list's shared Export (copies the JWSO pilot).
//
// One sheet "Saved Reports": the list's own columns as the user sees them.
// Every cell already shows plain words (Shared / Private, the source label),
// so no exportValue is needed. The API answers `reports`, not `items`.

import type { ListSavedReportsQuery, ListSavedReportsResponse } from '@innovic/shared';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchSavedReportsPage } from '../api';

export type SavedReportRow = ListSavedReportsResponse['reports'][number];

export interface SavedReportsExportArgs {
  columns: DataTableColumn<SavedReportRow>[];
  tableKey: string;
  search: string | undefined;
  sfParam: string | undefined;
}

export function savedReportsExportSpec(a: SavedReportsExportArgs): ListExportSpec<SavedReportRow> {
  const words = [
    a.search ? `search "${a.search}"` : null,
    a.sfParam ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  const base: Omit<ListSavedReportsQuery, 'limit' | 'offset'> = {
    ...(a.search ? { search: a.search } : {}),
    ...(a.sfParam ? { sf: a.sfParam } : {}),
  };
  return {
    fileName: 'Saved Reports',
    tableKey: a.tableKey,
    columns: a.columns,
    rowKey: (r) => r.id,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: async (limit, offset) => {
      const r = await fetchSavedReportsPage({ ...base, limit, offset });
      return { items: r.reports, total: r.total };
    },
  };
}
