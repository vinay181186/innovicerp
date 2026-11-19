// ADR-310 — the Daily Task Reports list's shared Export (copies the JWSO pilot).
//
// One sheet "Daily Task Reports": the list's own columns as the user sees them.
// The Hours cell is a coloured "8.5h" span, so it exports the plain number.

import type { DailyTaskReportRow } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { type DailyReportFilters, fetchDailyReportPage } from '../api';

export function withDailyReportExportValues(
  columns: DataTableColumn<DailyTaskReportRow>[],
): DataTableColumn<DailyTaskReportRow>[] {
  return columns.map((c) =>
    c.id === 'hours' ? { ...c, exportValue: (r) => Number(r.totalHours.toFixed(1)) } : c,
  );
}

export interface DailyReportExportArgs {
  columns: DataTableColumn<DailyTaskReportRow>[];
  tableKey: string;
  userId: string | undefined;
  userName: string | undefined;
  dateFrom: string | undefined;
  dateTo: string | undefined;
  search: string | undefined;
  sfParam: string | undefined;
}

export function dailyReportExportSpec(
  a: DailyReportExportArgs,
): ListExportSpec<DailyTaskReportRow> {
  const words = [
    a.search ? `search "${a.search}"` : null,
    a.userId ? `User: ${a.userName ?? 'picked user'}` : null,
    a.dateFrom ? `from ${fmtDate(a.dateFrom)}` : null,
    a.dateTo ? `to ${fmtDate(a.dateTo)}` : null,
    a.sfParam ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  const base: DailyReportFilters = {
    userId: a.userId,
    dateFrom: a.dateFrom,
    dateTo: a.dateTo,
    search: a.search,
    sf: a.sfParam,
  };
  return {
    fileName: 'Daily Task Reports',
    tableKey: a.tableKey,
    columns: a.columns,
    rowKey: (r) => r.id,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: async (limit, offset) => {
      const res = await fetchDailyReportPage({ ...base, limit, offset });
      return { items: res.reports, total: res.total };
    },
  };
}
