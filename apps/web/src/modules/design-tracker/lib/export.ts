// ADR-310 — the Design Tracker list's shared Export (copies the JWSO pilot).
//
// One sheet "Design Tracker": the list's own columns as the user sees them.
// Design No., Due Date, the Design Status badge and the coloured hour figures
// are components, so they get their plain values.

import type { DesignTrackerListItem, ListDesignTrackerQuery } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchDesignTrackerPage } from '../api';

const EXPORT_VALUE: Record<string, (d: DesignTrackerListItem) => string | number | null> = {
  design_no: (d) => d.code,
  due_date: (d) => fmtDate(d.targetDate, ''),
  status: (d) => d.status,
  booked_hours: (d) => d.totalHours,
  estimated_hours: (d) => d.estimatedHours,
};

export function withDesignTrackerExportValues(
  columns: DataTableColumn<DesignTrackerListItem>[],
): DataTableColumn<DesignTrackerListItem>[] {
  return columns.map((c) => {
    const ev = c.id ? EXPORT_VALUE[c.id] : undefined;
    return ev ? { ...c, exportValue: ev } : c;
  });
}

export interface DesignTrackerExportArgs {
  columns: DataTableColumn<DesignTrackerListItem>[];
  tableKey: string;
  search: string | undefined;
  filter: ListDesignTrackerQuery['filter'];
  /** The Design Status filter's words, undefined for All. */
  filterLabel: string | undefined;
  sfParam: string | undefined;
}

export function designTrackerExportSpec(
  a: DesignTrackerExportArgs,
): ListExportSpec<DesignTrackerListItem> {
  const words = [
    a.search ? `search "${a.search}"` : null,
    a.filterLabel ? `Design Status: ${a.filterLabel}` : null,
    a.sfParam ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  return {
    fileName: 'Design Tracker',
    tableKey: a.tableKey,
    columns: a.columns,
    rowKey: (r) => r.id,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: (limit, offset) =>
      fetchDesignTrackerPage({
        search: a.search,
        filter: a.filter,
        sf: a.sfParam,
        limit,
        offset,
      }),
  };
}
