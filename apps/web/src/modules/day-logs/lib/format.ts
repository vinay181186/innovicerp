// Display helpers for the Day Log screens. Nothing here decides a rule — the
// server's `summary` / row figures carry every number the user is judged by;
// these only turn loaded data into chips, date labels and a ticking clock.

import type { DayLogCurrentStatus, DayLogStatus } from '@innovic/shared';
import { DAY_LOG_STATUS_LABELS, hhmmToMin, minToHhmm } from '@innovic/shared';

export const DAY_STATUS_BADGE: Record<DayLogStatus, string> = {
  open: 'b-blue',
  submitted: 'b-green',
  leave: 'b-grey',
};

/** Team Day Logs "Now" chip. */
export const CURRENT_STATUS_BADGE: Record<DayLogCurrentStatus, string> = {
  working: 'b-blue',
  break: 'b-grey',
  idle: 'b-orange',
  not_started: 'b-grey',
  submitted: 'b-green',
  leave: 'b-grey',
};

/** A PAST day's chip label for the same status (no "now" on a past day). */
export const PAST_STATUS_LABEL: Record<DayLogCurrentStatus, string> = {
  working: 'Not submitted',
  break: 'Not submitted',
  idle: 'Not submitted',
  not_started: 'No entries',
  submitted: 'Submitted',
  leave: 'Leave',
};

export function dayStatusLabel(s: DayLogStatus): string {
  return DAY_LOG_STATUS_LABELS[s];
}

/** The day chip: Submitted / Leave, else Open today and Not submitted on a past day. */
export function dayChip(
  status: DayLogStatus | null,
  isToday: boolean,
  hasEntries = true,
): { cls: string; label: string } {
  if (status === 'submitted' || status === 'leave')
    return { cls: DAY_STATUS_BADGE[status], label: dayStatusLabel(status) };
  if (isToday) return { cls: 'b-blue', label: 'Open' };
  return hasEntries
    ? { cls: 'b-orange', label: 'Not submitted' }
    : { cls: 'b-grey', label: 'No entries' };
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
 *  (the Working elapsed figure, the time picker's "Now" and its upper limit). */
export function liveNowMin(serverNow: string, fetchedAt: number, nowMs: number): number {
  const drift = Math.max(0, Math.floor((nowMs - fetchedAt) / 60_000));
  return Math.min(24 * 60 - 1, hhmmToMin(serverNow) + drift);
}

/**
 * A typed 24-hour time → "HH:MM", or null when it is not a time. Accepts
 * "1130", "11.30", "11:30", "930", "9:30" and "9" (= 09:00). Every time field
 * of the Day Log goes through this (never a browser type="time" box, which
 * shows AM/PM on some PCs).
 */
export function parseHhmm(raw: string): string | null {
  const s = raw.trim();
  let h: number;
  let m: number;
  const sep = /^(\d{1,2})[:.](\d{2})$/.exec(s);
  if (sep) {
    h = Number(sep[1]);
    m = Number(sep[2]);
  } else if (/^\d{1,4}$/.test(s)) {
    const cut = s.length <= 2 ? s.length : s.length - 2;
    h = Number(s.slice(0, cut));
    m = s.length <= 2 ? 0 : Number(s.slice(cut));
  } else {
    return null;
  }
  if (!Number.isInteger(h) || !Number.isInteger(m) || h > 23 || m > 59) return null;
  return minToHhmm(h * 60 + m);
}

/** Error text for an inline notice. */
export function errText(e: unknown, fallback = 'Something went wrong. Try again.'): string {
  return e instanceof Error && e.message ? e.message : fallback;
}
