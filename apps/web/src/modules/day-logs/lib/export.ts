// Day Log → CSV / Excel, and the table models the print reuses, so the
// screen's export, its print and its file carry the same columns.
//
// CSV goes through the reports module's rowsToCsv / downloadCsv; Excel loads
// SheetJS (xlsx, the existing dependency) only when asked, as op-log does.

import type { DayLogDetail, TeamDayLogResponse } from '@innovic/shared';
import {
  DAY_LOG_CURRENT_STATUS_LABELS,
  DAY_LOG_ENTRY_KIND_LABELS,
  fmtDuration,
} from '@innovic/shared';
import { downloadCsv, rowsToCsv } from '@/modules/reports/lib/csv';
import { PAST_STATUS_LABEL } from './format';

export interface ExportTable {
  /** Column keys deliberately avoid a `status` / `type` suffix: rowsToCsv
   *  re-labels such columns as report codes. */
  columns: { key: string; label: string }[];
  rows: Record<string, string>[];
}

export const DAY_COLUMNS = [
  { key: 'start_time', label: 'Start' },
  { key: 'stop_time', label: 'Stop' },
  { key: 'time', label: 'Time' },
  { key: 'kind', label: 'Type' },
  { key: 'work', label: 'Working on' },
  { key: 'order_code', label: 'SO / JWSO' },
  { key: 'entry_state', label: 'Status' },
  { key: 'late', label: 'Late' },
  { key: 'remark', label: 'Remark' },
];

export function dayTable(day: DayLogDetail): ExportTable {
  const rows = [...day.entries]
    .sort((a, b) => a.fromTime.localeCompare(b.fromTime))
    .map((e) => ({
      start_time: e.fromTime,
      stop_time: e.toTime ?? '',
      time: fmtDuration(e.minutes),
      kind: DAY_LOG_ENTRY_KIND_LABELS[e.kind],
      work: e.description,
      order_code: e.order?.code ?? '',
      entry_state: e.toTime ? 'Closed' : 'Open',
      late: e.late ? 'LATE' : '',
      remark: e.remarks ?? '',
    }));
  return { columns: DAY_COLUMNS, rows };
}

export const TEAM_COLUMNS = [
  { key: 'user', label: 'User' },
  { key: 'current_now', label: 'Now' },
  { key: 'latest_work', label: 'Working on (latest)' },
  { key: 'latest_order', label: 'SO / JWSO' },
  { key: 'first_start', label: 'First start' },
  { key: 'last_stop', label: 'Last stop' },
  { key: 'work_hours', label: 'Working hours' },
  { key: 'break_min', label: 'Break' },
  { key: 'entries', label: 'Entries' },
  { key: 'late', label: 'Late' },
];

export function teamTable(team: TeamDayLogResponse): ExportTable {
  const isToday = team.date === team.today;
  return {
    columns: TEAM_COLUMNS,
    rows: team.rows.map((r) => ({
      user: r.userName,
      current_now: isToday
        ? [DAY_LOG_CURRENT_STATUS_LABELS[r.currentStatus], r.currentText]
            .filter(Boolean)
            .join(' · ')
        : PAST_STATUS_LABEL[r.currentStatus],
      latest_work: r.latestWork?.description ?? '',
      latest_order: r.latestWork?.orderCode ?? '',
      first_start: r.firstStart ?? '',
      last_stop: r.lastStop ?? '',
      work_hours: fmtDuration(r.workMin),
      break_min: `${r.breakMin} min`,
      entries: String(r.entryCount),
      late: r.lateCount > 0 ? String(r.lateCount) : '',
    })),
  };
}

/** "User 1" → "user-1" for a file name. */
export function fileSlug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'user'
  );
}

export function exportCsv(t: ExportTable, baseName: string): void {
  const cols = t.columns.map((c) => ({ ...c, type: 'text' as const }));
  downloadCsv(`${baseName}.csv`, rowsToCsv(cols, t.rows));
}

export async function exportXlsx(t: ExportTable, baseName: string, sheet: string): Promise<void> {
  const data = t.rows.map((r) => Object.fromEntries(t.columns.map((c) => [c.label, r[c.key]])));
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.json_to_sheet(data, { header: t.columns.map((c) => c.label) });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheet);
  XLSX.writeFile(wb, `${baseName}.xlsx`);
}
