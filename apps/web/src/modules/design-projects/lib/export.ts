// ADR-310 — the Design Projects list's shared Export (copies the JWSO pilot).
//
// One sheet "Design Projects": the list's own columns as the user sees them.
// Project No. (a link), Due Date (red + ⚠ when late), the Project Status badge,
// the Progress bar and the red Open Issues figure are components, so they get
// their plain values.

import type { DesignProjectListItem, ListDesignProjectsQuery } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchDesignProjectsPage } from '../api';

const EXPORT_VALUE: Record<string, (p: DesignProjectListItem) => string | number | null> = {
  project_no: (p) => p.code,
  due_date: (p) => fmtDate(p.targetDate, ''),
  status: (p) => p.status,
  progress: (p) => p.taskProgressPct,
  open_issues: (p) => p.openIssuesCount,
};

export function withDesignProjectExportValues(
  columns: DataTableColumn<DesignProjectListItem>[],
): DataTableColumn<DesignProjectListItem>[] {
  return columns.map((c) => {
    const ev = c.id ? EXPORT_VALUE[c.id] : undefined;
    return ev ? { ...c, exportValue: ev } : c;
  });
}

export interface DesignProjectExportArgs {
  columns: DataTableColumn<DesignProjectListItem>[];
  tableKey: string;
  search: string | undefined;
  filter: ListDesignProjectsQuery['filter'];
  /** The Project filter's words ("Active"), undefined for All. */
  filterLabel: string | undefined;
  sfParam: string | undefined;
}

export function designProjectExportSpec(
  a: DesignProjectExportArgs,
): ListExportSpec<DesignProjectListItem> {
  const words = [
    a.search ? `search "${a.search}"` : null,
    a.filterLabel ? `Projects: ${a.filterLabel}` : null,
    a.sfParam ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  return {
    fileName: 'Design Projects',
    tableKey: a.tableKey,
    columns: a.columns,
    rowKey: (r) => r.id,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: (limit, offset) =>
      fetchDesignProjectsPage({
        search: a.search,
        filter: a.filter,
        sf: a.sfParam,
        limit,
        offset,
      }),
  };
}
