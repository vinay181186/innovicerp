// ADR-310 — the Rev Substitutions list's shared Export (copies the JWSO pilot).
//
// One sheet "Rev Substitutions": the list's own columns as the user sees
// them. Every cell already shows plain words, so no exportValue is needed.

import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchRevSubstitutionsPage, type RevSubstitutionRow } from '../api';

export interface RevSubExportArgs {
  columns: DataTableColumn<RevSubstitutionRow>[];
  tableKey: string;
  search: string | undefined;
  sfParam: string | undefined;
}

export function revSubExportSpec(a: RevSubExportArgs): ListExportSpec<RevSubstitutionRow> {
  const words = [
    a.search ? `search "${a.search}"` : null,
    a.sfParam ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  // The same query object the list sends (routes/list.tsx).
  const base = {
    ...(a.search ? { search: a.search } : {}),
    ...(a.sfParam ? { sf: a.sfParam } : {}),
  };
  return {
    fileName: 'Rev Substitutions',
    tableKey: a.tableKey,
    columns: a.columns,
    rowKey: (r) => r.id,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: (limit, offset) => fetchRevSubstitutionsPage({ ...base, limit, offset }),
  };
}
