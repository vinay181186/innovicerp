// Day Log → CSV / Excel, and the table models the print reuses, so the
// screen's export, its print and its file carry the same columns.
//
// CSV goes through the reports module's rowsToCsv / downloadCsv; Excel loads
// SheetJS (xlsx, the existing dependency) only when asked, as op-log does.

import type { DayLogDetail, TeamDayLogResponse } from '@innovic/shared';
import { DAY_LOG_CURRENT_STATUS_LABELS, fmtDuration } from '@innovic/shared';
import { downloadCsv, rowsToCsv } from '@/modules/reports/lib/csv';
import { dayStatusLabel, entryDuration, workStatusLabel } from './format';

export interface ExportTable {
  /** Column keys deliberately avoid a `status` / `type` suffix: rowsToCsv
   *  re-labels such columns as report codes. */
  columns: { key: string; label: string }[];
  rows: Record<string, string>[];
}

export const DAY_COLUMNS = [
  { key: 'no', label: '#' },
  { key: 'from_time', label: 'From' },
  { key: 'to_time', label: 'To' },
  { key: 'time', label: 'Time' },
  { key: 'work', label: 'Work done' },
  { key: 'work_state', label: 'Work Status' },
];

export function dayTable(day: DayLogDetail): ExportTable {
  let n = 0;
  const rows = day.entries.map((e) => {
    if (e.kind === 'work') n += 1;
    return {
      no: e.kind === 'work' ? String(n) : '',
      from_time: e.fromTime,
      to_time: e.toTime ?? '',
      time: entryDuration(e),
      work: e.description,
      work_state: workStatusLabel(e),
    };
  });
  return { columns: DAY_COLUMNS, rows };
}

export const TEAM_COLUMNS = [
  { key: 'user', label: 'User' },
  { key: 'dept', label: 'Department' },
  { key: 'tier', label: 'Right' },
  { key: 'logged', label: 'Logged' },
  { key: 'required', label: 'Work needed' },
  { key: 'missing', label: 'Missing' },
  { key: 'missing_from', label: 'Missing From' },
  { key: 'current_now', label: 'Current Status' },
  { key: 'day_state', label: 'Day Status' },
];

export function teamTable(team: TeamDayLogResponse): ExportTable {
  return {
    columns: TEAM_COLUMNS,
    rows: team.rows.map((r) => ({
      user: r.userName,
      dept: r.deptLabel ?? '',
      tier: r.tierLabel ?? '',
      logged: fmtDuration(r.loggedMin),
      required: fmtDuration(r.requiredMin),
      missing: r.missingMin > 0 ? fmtDuration(r.missingMin) : '',
      missing_from: r.missingFrom ?? '',
      current_now: [DAY_LOG_CURRENT_STATUS_LABELS[r.currentStatus], r.currentText]
        .filter(Boolean)
        .join(' · '),
      day_state: dayStatusLabel(r.status),
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
