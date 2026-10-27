// Display helpers for the Day Log screens. Nothing here decides a rule — the
// server's `summary` / row figures carry every number the user is judged by;
// these only turn loaded data into chips, date labels and a ticking clock.

import type { TeamDayLogRow } from '@innovic/shared';
import { DAY_LOG_CURRENT_STATUS_LABELS, hhmmToMin } from '@innovic/shared';

/** Team Day Logs "Now" chip. Today: Working / Idle / Not started; a past
 *  day: Logged / No entries. (Older statuses fall back on the entry count.) */
export function nowChip(
  r: Pick<TeamDayLogRow, 'currentStatus' | 'entryCount'>,
  isToday: boolean,
): { cls: string; label: string } {
  if (!isToday) {
    return r.entryCount > 0
      ? { cls: 'b-green', label: 'Logged' }
      : { cls: 'b-grey', label: 'No entries' };
  }
  if (r.currentStatus === 'working')
    return { cls: 'b-blue', label: DAY_LOG_CURRENT_STATUS_LABELS.working };
  if (r.currentStatus === 'not_started' || r.entryCount === 0)
    return { cls: 'b-grey', label: DAY_LOG_CURRENT_STATUS_LABELS.not_started };
  return { cls: 'b-orange', label: DAY_LOG_CURRENT_STATUS_LABELS.idle };
}

/** Calendar day ± n, "YYYY-MM-DD" (UTC arithmetic, so no DST/zone drift). */
export function shiftDate(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function weekday(date: string): string {
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()] ?? '';
}

/** "26-10-2026". */
export function fmtDmy(date: string): string {
  return `${date.slice(8, 10)}-${date.slice(5, 7)}-${date.slice(0, 4)}`;
}

/** `today` and the `count - 1` days before it, newest first. */
export function recentDays(today: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => shiftDate(today, -i));
}

/** The server's clock moved on by the time since it answered — display only
 *  (the time picker's "Now" and its upper limit). */
export function liveNowMin(serverNow: string, fetchedAt: number, nowMs: number): number {
  const drift = Math.max(0, Math.floor((nowMs - fetchedAt) / 60_000));
  return Math.min(24 * 60 - 1, hhmmToMin(serverNow) + drift);
}

/** Error text for an inline notice. */
export function errText(e: unknown, fallback = 'Something went wrong. Try again.'): string {
  return e instanceof Error && e.message ? e.message : fallback;
}
