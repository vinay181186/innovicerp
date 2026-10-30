// Day Log → CSV / Excel, and the table models the print reuses, so the
// screen's export, its print and its file carry the same columns.
//
// CSV goes through the reports module's rowsToCsv / downloadCsv; Excel loads
// SheetJS (xlsx, the existing dependency) only when asked, as op-log does.

import type { DayLogDetail, DayLogPersonDay, TeamDayLogResponse } from '@innovic/shared';
import { fmt12, fmtDuration } from '@innovic/shared';
import { downloadCsv, rowsToCsv } from '@/modules/reports/lib/csv';
import { istStamp } from './format';
import { sortEntries } from './sheet';

export interface ExportTable {
  /** Column keys deliberately avoid a `status` / `type` suffix: rowsToCsv
   *  re-labels such columns as report codes. */
  columns: { key: string; label: string }[];
  rows: Record<string, string>[];
}

/** My Day Log: Sr No · Start Time · Stop Time · Working Hours · SO / JWSO ·
 *  Working On (full text, never cut). */
export const DAY_COLUMNS = [
  { key: 'sr_no', label: 'Sr No' },
  { key: 'start_time', label: 'Start Time' },
  { key: 'stop_time', label: 'Stop Time' },
  { key: 'work_hours', label: 'Working Hours' },
  { key: 'order_code', label: 'SO / JWSO' },
  { key: 'work', label: 'Working On' },
];

/** Column keys the print right-aligns. */
export const DAY_NUM_KEYS = ['sr_no', 'work_hours', 'entry_rev_no'] as const;

export function dayTable(day: DayLogDetail): ExportTable {
  const rows = sortEntries(day.entries).map((e, i) => ({
    sr_no: String(i + 1),
    start_time: fmt12(e.fromTime),
    stop_time: e.toTime ? fmt12(e.toTime) : '',
    work_hours: fmtDuration(e.minutes),
    order_code: e.order?.code ?? '',
    work: e.description,
  }));
  return { columns: DAY_COLUMNS, rows };
}

/** Team Day Logs › a person, one day: Sr No · Start Time · Stop Time ·
 *  Working Hours · (Super Admin: Entry Rev No · Entry Rev Date · Entry
 *  Rev Time ·) SO / JWSO · Working On. */
export function personDayTable(p: DayLogPersonDay): ExportTable {
  const rev = p.isSuperAdmin
    ? [
        { key: 'entry_rev_no', label: 'Entry Rev No' },
        { key: 'entry_rev_date', label: 'Entry Rev Date' },
        { key: 'entry_rev_time', label: 'Entry Rev Time' },
      ]
    : [];
  const columns = [...DAY_COLUMNS.slice(0, 4), ...rev, ...DAY_COLUMNS.slice(4)];
  const rows = sortEntries(p.entries).map((e) => {
    const at = e.entryRevNo ? istStamp(e.entryRevisedAt) : null;
    return {
      sr_no: String(e.srNo),
      start_time: fmt12(e.fromTime),
      stop_time: e.toTime ? fmt12(e.toTime) : '',
      work_hours: fmtDuration(e.minutes),
      entry_rev_no: e.entryRevNo === null ? '' : String(e.entryRevNo),
      entry_rev_date: at?.date ?? '',
      entry_rev_time: at?.time ?? '',
      order_code: e.order?.code ?? '',
      work: e.description,
    };
  });
  return { columns, rows };
}

/** Team Day Logs: User · First start · Last stop · Working hours · Entries
 *  (the screen's columns — no Now / Late, owner 2026-10-30). */
export const TEAM_COLUMNS = [
  { key: 'user', label: 'User' },
  { key: 'first_start', label: 'First start' },
  { key: 'last_stop', label: 'Last stop' },
  { key: 'work_hours', label: 'Working hours' },
  { key: 'entries', label: 'Entries' },
];

export function teamTable(team: TeamDayLogResponse): ExportTable {
  return {
    columns: TEAM_COLUMNS,
    rows: team.rows.map((r) => ({
      user: r.userName,
      first_start: r.firstStart ? fmt12(r.firstStart) : '',
      last_stop: r.lastStop ? fmt12(r.lastStop) : '',
      work_hours: fmtDuration(r.workMin),
      entries: String(r.entryCount),
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
