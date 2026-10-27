// Day Log → CSV / Excel, and the table models the print reuses, so the
// screen's export, its print and its file carry the same columns.
//
// CSV goes through the reports module's rowsToCsv / downloadCsv; Excel loads
// SheetJS (xlsx, the existing dependency) only when asked, as op-log does.

import type { DayLogDetail, TeamDayLogResponse } from '@innovic/shared';
import { fmt12, fmtDuration } from '@innovic/shared';
import { downloadCsv, rowsToCsv } from '@/modules/reports/lib/csv';
import { nowChip } from './format';

export interface ExportTable {
  /** Column keys deliberately avoid a `status` / `type` suffix: rowsToCsv
   *  re-labels such columns as report codes. */
  columns: { key: string; label: string }[];
  rows: Record<string, string>[];
}

/** The day sheet: # · Start · Stop · SO / JWSO · Time · Working on. */
export const DAY_COLUMNS = [
  { key: 'row_no', label: '#' },
  { key: 'start_time', label: 'Start' },
  { key: 'stop_time', label: 'Stop' },
  { key: 'order_code', label: 'SO / JWSO' },
  { key: 'time', label: 'Time' },
  { key: 'work', label: 'Working on' },
];

export function dayTable(day: DayLogDetail): ExportTable {
  const rows = [...day.entries]
    .sort((a, b) => a.fromTime.localeCompare(b.fromTime))
    .map((e, i) => ({
      row_no: String(i + 1),
      start_time: fmt12(e.fromTime),
      stop_time: e.toTime ? fmt12(e.toTime) : '',
      order_code: e.order?.code ?? '',
      time: fmtDuration(e.minutes),
      work: e.description,
    }));
  return { columns: DAY_COLUMNS, rows };
}

/** Team Day Logs: User · Now · First start · Last stop · Working hours ·
 *  Entries · Late. */
export const TEAM_COLUMNS = [
  { key: 'user', label: 'User' },
  { key: 'current_now', label: 'Now' },
  { key: 'first_start', label: 'First start' },
  { key: 'last_stop', label: 'Last stop' },
  { key: 'work_hours', label: 'Working hours' },
  { key: 'entries', label: 'Entries' },
  { key: 'late', label: 'Late' },
];

export function teamTable(team: TeamDayLogResponse): ExportTable {
  const isToday = team.date === team.today;
  return {
    columns: TEAM_COLUMNS,
    rows: team.rows.map((r) => ({
      user: r.userName,
      current_now: [nowChip(r, isToday).label, isToday ? r.currentText : null]
        .filter(Boolean)
        .join(' · '),
      first_start: r.firstStart ? fmt12(r.firstStart) : '',
      last_stop: r.lastStop ? fmt12(r.lastStop) : '',
      work_hours: fmtDuration(r.workMin),
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
