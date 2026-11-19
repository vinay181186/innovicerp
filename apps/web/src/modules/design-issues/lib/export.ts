// ADR-310 — the All Design Issues list's shared Export (copies the JWSO pilot).
//
// One sheet "All Design Issues": the list's own columns as the user sees them.
// Issue (a link), Project (a coloured span), the Severity / Issue Status badges
// and Days Open ("6d" in red) are components, so they get their plain values.

import type { DesignIssueListItem, ListDesignIssuesQuery } from '@innovic/shared';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchDesignIssuesPage } from '../api';

const EXPORT_VALUE: Record<string, (i: DesignIssueListItem) => string | number | null> = {
  issue: (i) => i.title,
  project: (i) => i.projectName,
  severity: (i) => i.severity,
  status: (i) => i.status,
  days_open: (i) => i.ageDays,
};

export function withDesignIssueExportValues(
  columns: DataTableColumn<DesignIssueListItem>[],
): DataTableColumn<DesignIssueListItem>[] {
  return columns.map((c) => {
    const ev = c.id ? EXPORT_VALUE[c.id] : undefined;
    return ev ? { ...c, exportValue: ev } : c;
  });
}

export interface DesignIssueExportArgs {
  columns: DataTableColumn<DesignIssueListItem>[];
  tableKey: string;
  search: string | undefined;
  filter: ListDesignIssuesQuery['filter'];
  /** The Issue filter's words ("Open"), undefined for All. */
  filterLabel: string | undefined;
  sfParam: string | undefined;
}

export function designIssueExportSpec(
  a: DesignIssueExportArgs,
): ListExportSpec<DesignIssueListItem> {
  const words = [
    a.search ? `search "${a.search}"` : null,
    a.filterLabel ? `Issues: ${a.filterLabel}` : null,
    a.sfParam ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  return {
    fileName: 'All Design Issues',
    tableKey: a.tableKey,
    columns: a.columns,
    rowKey: (r) => r.id,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: (limit, offset) =>
      fetchDesignIssuesPage({
        search: a.search,
        filter: a.filter,
        sf: a.sfParam,
        limit,
        offset,
      }),
  };
}
