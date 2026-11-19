// ADR-310 — the Engineering Change list's shared Export (copies the JWSO pilot).
//
// One sheet "Engineering Change": the list's own columns as the user sees
// them. The ECR Status chip is a component, so it gets its plain word. There
// is no Lines sheet: an ECR has no lines and the API no per-line list.

import { ECR_STATUS_LABELS, type EcrListRow, type ListEcrQuery } from '@innovic/shared';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchEcrPage } from '../api';

export function withEcrExportValues(
  columns: DataTableColumn<EcrListRow>[],
): DataTableColumn<EcrListRow>[] {
  return columns.map((c) =>
    c.id === 'status' ? { ...c, exportValue: (r) => ECR_STATUS_LABELS[r.status] } : c,
  );
}

export interface EcrExportArgs {
  columns: DataTableColumn<EcrListRow>[];
  tableKey: string;
  search: string | undefined;
  sfParam: string | undefined;
}

export function ecrExportSpec(a: EcrExportArgs): ListExportSpec<EcrListRow> {
  const words = [
    a.search ? `search "${a.search}"` : null,
    a.sfParam ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  const base: Omit<ListEcrQuery, 'limit' | 'offset'> = {
    ...(a.search ? { search: a.search } : {}),
    ...(a.sfParam ? { sf: a.sfParam } : {}),
  };
  return {
    fileName: 'Engineering Change',
    tableKey: a.tableKey,
    columns: a.columns,
    rowKey: (r) => r.id,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: (limit, offset) => fetchEcrPage({ ...base, limit, offset }),
  };
}
