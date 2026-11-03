// Display helpers for the Day Log screens. Nothing here decides a rule — the
// server's `summary` / row figures carry every number the user is judged by;
// these only turn loaded data into chips, date labels and a ticking clock.

import { hhmmToMin } from '@innovic/shared';
import { fmtDate, fmtTime } from '@/lib/date';

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

/** The server's clock moved on by the time since it answered — display only
 *  (the time picker's "Now" and its upper limit). */
export function liveNowMin(serverNow: string, fetchedAt: number, nowMs: number): number {
  const drift = Math.max(0, Math.floor((nowMs - fetchedAt) / 60_000));
  return Math.min(24 * 60 - 1, hhmmToMin(serverNow) + drift);
}

/** A timestamp in IST as { date: "29-10-2026", time: "03:10 PM" } — how the
 *  Day Log shows reply and revision times (ADR-255). The app's one date /
 *  time format (lib/date). Unparseable → "—". */
export function istStamp(ts: string | null | undefined): { date: string; time: string } {
  const d = ts ? new Date(ts) : null;
  if (!ts || !d || Number.isNaN(d.getTime())) return { date: '—', time: '—' };
  return { date: fmtDate(ts), time: fmtTime(ts, '—') };
}

/** "29-10-2026 03:10 PM". */
export function fmtStamp(ts: string | null | undefined): string {
  const s = istStamp(ts);
  return ts ? `${s.date} ${s.time}` : '—';
}

/** "Shivani Udaypalsinh Chauhan" → "Shivani". */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** Error text for an inline notice. */
export function errText(e: unknown, fallback = 'Something went wrong. Try again.'): string {
  return e instanceof Error && e.message ? e.message : fallback;
}
