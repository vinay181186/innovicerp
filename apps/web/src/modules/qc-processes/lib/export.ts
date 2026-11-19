// ADR-310 — the QC Process Master's shared Export (copies the JWSO pilot).
//
// One sheet "QC Process Master": the list's own columns as the user sees
// them. The Report Type cell carries a Mandatory chip and Status is a
// StatusBadge, so both get their plain words. No money on this master.

import type { ListQcProcessesQuery, QcProcess } from '@innovic/shared';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchQcProcessesPage } from '../api';

function reportTypeWords(p: QcProcess): string | null {
  if (!p.reportTypeName) return null;
  if (!p.reportMandatory) return p.reportTypeName;
  const rule = p.reportLastStageOnly ? 'Mandatory (last stage only)' : 'Mandatory';
  return `${p.reportTypeName} — ${rule}`;
}

export function withQcProcessExportValues(
  columns: DataTableColumn<QcProcess>[],
): DataTableColumn<QcProcess>[] {
  return columns.map((c) => {
    if (c.id === 'report_type') return { ...c, exportValue: reportTypeWords };
    if (c.id === 'is_active')
      return { ...c, exportValue: (p) => (p.isActive ? 'Active' : 'Inactive') };
    return c;
  });
}

export interface QcProcessExportArgs {
  columns: DataTableColumn<QcProcess>[];
  tableKey: string;
  search: string | undefined;
  isActive: boolean | undefined;
  sfParam: string | undefined;
}

export function qcProcessExportSpec(a: QcProcessExportArgs): ListExportSpec<QcProcess> {
  const words = [
    a.search ? `search "${a.search}"` : null,
    a.isActive === undefined ? null : a.isActive ? 'Active only' : 'Inactive only',
    a.sfParam ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  const base: Omit<ListQcProcessesQuery, 'limit' | 'offset'> = {
    ...(a.search ? { search: a.search } : {}),
    ...(a.isActive === undefined ? {} : { isActive: a.isActive }),
    ...(a.sfParam ? { sf: a.sfParam } : {}),
  };
  return {
    fileName: 'QC Process Master',
    tableKey: a.tableKey,
    columns: a.columns,
    rowKey: (r) => r.id,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: (limit, offset) => fetchQcProcessesPage({ ...base, limit, offset }),
  };
}
