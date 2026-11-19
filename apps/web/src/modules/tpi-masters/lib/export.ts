// ADR-310 — the TPI Master's shared Export (copies the JWSO pilot).
//
// One sheet "TPI Master": the list's own columns as the user sees them. The
// Status chip is a component, so it gets its plain word. No money here.

import type { ListTpiMastersQuery, TpiMaster } from '@innovic/shared';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchTpiMastersPage } from '../api';

export function withTpiExportValues(
  columns: DataTableColumn<TpiMaster>[],
): DataTableColumn<TpiMaster>[] {
  return columns.map((c) =>
    c.id === 'is_active' ? { ...c, exportValue: (t) => (t.isActive ? 'Active' : 'Inactive') } : c,
  );
}

export interface TpiExportArgs {
  columns: DataTableColumn<TpiMaster>[];
  tableKey: string;
  search: string | undefined;
  isActive: boolean | undefined;
  sfParam: string | undefined;
}

export function tpiExportSpec(a: TpiExportArgs): ListExportSpec<TpiMaster> {
  const words = [
    a.search ? `search "${a.search}"` : null,
    a.isActive === undefined ? null : a.isActive ? 'Active only' : 'Inactive only',
    a.sfParam ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  const base: Omit<ListTpiMastersQuery, 'limit' | 'offset'> = {
    ...(a.search ? { search: a.search } : {}),
    ...(a.isActive === undefined ? {} : { isActive: a.isActive }),
    ...(a.sfParam ? { sf: a.sfParam } : {}),
  };
  return {
    fileName: 'TPI Master',
    tableKey: a.tableKey,
    columns: a.columns,
    rowKey: (r) => r.id,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: (limit, offset) => fetchTpiMastersPage({ ...base, limit, offset }),
  };
}
