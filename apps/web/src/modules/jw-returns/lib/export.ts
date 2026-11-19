// ADR-310 — JW Return's shared Export (copy of the JWSO Master pilot,
// job-work-orders/lib/export-lines.ts).
//
// One sheet: the register's own columns as the user sees them (every cell is
// plain text the export reads, so no `exportValue` is needed). Each row is
// already one returned JWSO line, and the API has no per-line list endpoint,
// so there is no Lines sheet. A JW Return carries no money.

import type { JwReturnChallanListItem } from '@innovic/shared';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchJwReturnsPage } from '../api';

export interface JwReturnExportArgs {
  columns: DataTableColumn<JwReturnChallanListItem>[];
  tableKey: string;
  search: string | undefined;
  sfParam: string | undefined;
  hideMoney: boolean;
}

export function jwReturnExportSpec(a: JwReturnExportArgs): ListExportSpec<JwReturnChallanListItem> {
  const words = [
    a.search ? `search "${a.search}"` : null,
    a.sfParam ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  return {
    fileName: 'JW Return',
    tableKey: a.tableKey,
    columns: a.columns,
    rowKey: (r) => r.id,
    hideMoney: a.hideMoney,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: (limit, offset) =>
      fetchJwReturnsPage({
        ...(a.search ? { search: a.search } : {}),
        ...(a.sfParam ? { sf: a.sfParam } : {}),
        limit,
        offset,
      }),
  };
}
