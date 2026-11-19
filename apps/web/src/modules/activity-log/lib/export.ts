// ADR-310 — the Activity Log list's shared Export (copies the JWSO pilot).
//
// One sheet "Activity Log": the list's own columns as the user sees them. The
// Action badge is a component, so it gets its plain label. Exporting the log
// is itself logged (one EXPORT row) — that is intended.

import {
  activityActionLabel,
  type ActivityLogEntry,
  type ListActivityLogQuery,
} from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchActivityLogPage } from '../api';

export function withActivityLogExportValues(
  columns: DataTableColumn<ActivityLogEntry>[],
): DataTableColumn<ActivityLogEntry>[] {
  return columns.map((c) =>
    c.id === 'action' ? { ...c, exportValue: (r) => activityActionLabel(r.action) } : c,
  );
}

export interface ActivityLogExportArgs {
  columns: DataTableColumn<ActivityLogEntry>[];
  tableKey: string;
  defaultHidden?: string[] | undefined;
  search: string | undefined;
  action: string | undefined;
  userId: string | undefined;
  /** The picked user's name, for the filter words. */
  userName: string | undefined;
  fromDate: string | undefined;
  toDate: string | undefined;
  sfParam: string | undefined;
}

export function activityLogExportSpec(a: ActivityLogExportArgs): ListExportSpec<ActivityLogEntry> {
  const words = [
    a.search ? `search "${a.search}"` : null,
    a.action ? `Action: ${activityActionLabel(a.action)}` : null,
    a.userId ? `User: ${a.userName ?? 'picked user'}` : null,
    a.fromDate ? `from ${fmtDate(a.fromDate)}` : null,
    a.toDate ? `to ${fmtDate(a.toDate)}` : null,
    a.sfParam ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  const base: Omit<ListActivityLogQuery, 'limit' | 'offset'> = {
    ...(a.search ? { search: a.search } : {}),
    ...(a.action ? { action: a.action } : {}),
    ...(a.userId ? { userId: a.userId } : {}),
    ...(a.fromDate ? { fromDate: a.fromDate } : {}),
    ...(a.toDate ? { toDate: a.toDate } : {}),
    ...(a.sfParam ? { sf: a.sfParam } : {}),
  };
  return {
    fileName: 'Activity Log',
    tableKey: a.tableKey,
    columns: a.columns,
    defaultHidden: a.defaultHidden,
    rowKey: (r) => r.id,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: async (limit, offset) => {
      const res = await fetchActivityLogPage({ ...base, limit, offset });
      return { items: res.entries, total: res.total };
    },
  };
}
