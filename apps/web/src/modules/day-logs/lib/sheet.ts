// The SIMPLE My Day Log sheet (owner final 2026-10-27): the new rows the user
// types before Save, and the small helpers the sheet's rows share. A row is
// Start * · Stop * · SO / JWSO · Working on *. The rule check is the shared
// addDayLogEntriesInputSchema (the same one the server runs); the server
// still answers "Row N: …" for anything only it can see (overlap, after now).

import type { AddDayLogEntriesInput, DayLogOrder, DayLogSheetRow } from '@innovic/shared';
import { addDayLogEntriesInputSchema, fmt12, hhmmToMin, parseTime } from '@innovic/shared';

/** A new row, not saved yet. `desc` is Working on. */
export interface Draft {
  key: number;
  start: string;
  stop: string;
  desc: string;
  order: DayLogOrder | null;
}

let nextKey = 1;

export function blankDraft(): Draft {
  return { key: nextKey++, start: '', stop: '', desc: '', order: null };
}

/** The user has typed or picked something in this row. */
export function isFilled(d: Draft): boolean {
  return Boolean(d.start.trim() || d.stop.trim() || d.desc.trim() || d.order);
}

/** Minutes between two typed times, or null while either is not a time yet. */
export function spanMinutes(start: string, stop: string): number | null {
  const a = parseTime(start);
  const b = parseTime(stop);
  if (!a || !b) return null;
  const m = hhmmToMin(b) - hhmmToMin(a);
  return m > 0 ? m : null;
}

/** The batch body's row for a draft (times already checked by checkDrafts). */
export function toSheetRow(d: Draft): DayLogSheetRow {
  return {
    startTime: parseTime(d.start) ?? '',
    stopTime: parseTime(d.stop) ?? '',
    description: d.desc.trim(),
    orderType: d.order?.type ?? null,
    orderId: d.order?.id ?? null,
  };
}

/** The first row the shared rules refuse, as { index, text }; null = all fine. */
export function checkDrafts(
  date: string,
  rows: readonly Draft[],
): { index: number; text: string } | null {
  for (let i = 0; i < rows.length; i += 1) {
    const d = rows[i]!;
    if (!parseTime(d.start))
      return { index: i, text: 'Start time is compulsory — type 930 or pick it.' };
    if (!parseTime(d.stop))
      return { index: i, text: 'Stop time is compulsory — type 1030 or pick it.' };
  }
  const body: AddDayLogEntriesInput = { date, rows: rows.map(toSheetRow) };
  const check = addDayLogEntriesInputSchema.safeParse(body);
  if (check.success) return null;
  const issue = check.error.issues[0];
  const index = typeof issue?.path[1] === 'number' ? issue.path[1] : 0;
  return { index, text: issue?.message ?? 'Check the row.' };
}

/** "Row 2: Stop must be after …" → { row: 2, text: "Stop must be after …" }. */
export function rowError(message: string): { row: number; text: string } | null {
  const m = /^Row (\d+):\s*(.*)$/s.exec(message);
  return m ? { row: Number(m[1]), text: m[2] ?? message } : null;
}

/** "10:30 AM–11:15 AM". */
export function spanText(from: string, to: string | null): string {
  return `${fmt12(from)}–${fmt12(to)}`;
}
