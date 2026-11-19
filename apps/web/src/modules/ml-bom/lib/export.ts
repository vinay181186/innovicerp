// ADR-310 — the Multi-Level BOM list's shared Export (copies the JWSO pilot).
//
// One sheet "Multi-Level BOM": the list's own columns as the user sees them.
// The Default column draws a ✓, so it exports "Yes" (blank when not default).

import type { ListMlBomsQuery, MlBomListItem } from '@innovic/shared';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchMlBomsPage } from '../api';

function withMlBomExportValues(
  columns: DataTableColumn<MlBomListItem>[],
): DataTableColumn<MlBomListItem>[] {
  return columns.map((c) =>
    c.id === 'is_default'
      ? { ...c, exportValue: (b: MlBomListItem) => (b.isDefault ? 'Yes' : null) }
      : c,
  );
}

export interface MlBomExportArgs {
  columns: DataTableColumn<MlBomListItem>[];
  tableKey: string;
  search: string | undefined;
  sfParam: string | undefined;
}

export function mlBomExportSpec(a: MlBomExportArgs): ListExportSpec<MlBomListItem> {
  const words = [
    a.search ? `search "${a.search}"` : null,
    a.sfParam ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  const base: Omit<ListMlBomsQuery, 'limit' | 'offset'> = {
    ...(a.search ? { search: a.search } : {}),
    ...(a.sfParam ? { sf: a.sfParam } : {}),
  };
  return {
    fileName: 'Multi-Level BOM',
    tableKey: a.tableKey,
    columns: withMlBomExportValues(a.columns),
    rowKey: (b) => b.id,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: (limit, offset) => fetchMlBomsPage({ ...base, limit, offset }),
  };
}
