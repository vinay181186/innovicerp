// ADR-310 — the Assembly Tracker list's shared Export (copies the JWSO pilot).
//
// One sheet "Assembly Tracker": the list's own columns as the user sees them.
// The Due Date cell is coloured when overdue, so it gets a plain date. There
// is no Lines sheet: the API has no per-line assembly list endpoint.

import type { AssemblyListItem, ListAssembliesQuery } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchAssembliesPage } from '../api';

export function withAssemblyExportValues(
  columns: DataTableColumn<AssemblyListItem>[],
): DataTableColumn<AssemblyListItem>[] {
  return columns.map((c) =>
    c.id === 'due' ? { ...c, exportValue: (r) => fmtDate(r.dueDate, '') || null } : c,
  );
}

export interface AssemblyExportArgs {
  columns: DataTableColumn<AssemblyListItem>[];
  tableKey: string;
  /** The list's own query (search, status, sf). */
  query: ListAssembliesQuery;
  /** The status option's label as the dropdown shows it. */
  statusLabel: string | undefined;
}

export function assemblyExportSpec(a: AssemblyExportArgs): ListExportSpec<AssemblyListItem> {
  const words = [
    a.query.search ? `search "${a.query.search}"` : null,
    a.statusLabel ? `Status ${a.statusLabel}` : null,
    a.query.sf ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  return {
    fileName: 'Assembly Tracker',
    tableKey: a.tableKey,
    columns: a.columns,
    rowKey: (r) => r.soId,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: (limit, offset) => fetchAssembliesPage({ ...a.query, limit, offset }),
  };
}
