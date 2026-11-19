// ADR-310 — the CAPA list's shared Export (copies the JWSO pilot).
//
// One sheet: the list's own columns as the user sees them. The Target cell
// adds " ⚠" when overdue, so it gets the plain date. There is no Lines
// sheet: a CAPA has no lines and the API no per-line list.

import type { CapaRecord } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchCapaPage } from '../api';

export function withCapaExportValues(
  columns: DataTableColumn<CapaRecord>[],
): DataTableColumn<CapaRecord>[] {
  return columns.map((c) =>
    c.id === 'target' ? { ...c, exportValue: (r) => fmtDate(r.targetDate, '') || null } : c,
  );
}

export interface CapaExportArgs {
  /** The list's title as shown (CAPA, or the NC Register tab's own title). */
  title: string;
  columns: DataTableColumn<CapaRecord>[];
  tableKey: string;
  search: string | undefined;
  sfParam: string | undefined;
}

export function capaExportSpec(a: CapaExportArgs): ListExportSpec<CapaRecord> {
  const words = [
    a.search ? `search "${a.search}"` : null,
    a.sfParam ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  return {
    fileName: a.title,
    tableKey: a.tableKey,
    columns: a.columns,
    rowKey: (c) => c.id,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: (limit, offset) => fetchCapaPage({ search: a.search, sf: a.sfParam, limit, offset }),
  };
}
