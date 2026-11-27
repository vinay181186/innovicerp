// SO / JWSO status by day (ADR-325) — display helpers only. Every figure is the
// server's; these turn loaded days into rows, week headings, ranges and cell text.

import {
  type OrderKind,
  type OrderStatusFigures,
  type OrderStatusSummary,
  type SoJwsoStatusDay,
  SO_JWSO_STATUS_MAX_DAYS,
  sfPresetRange,
} from '@innovic/shared';
import { addDaysLocal, daysBetweenLocal, fmtDate, fmtTime } from '@/lib/date';
import { fmtQty } from '@/lib/qty-format';

/** Every day, or only the newest day of each Mon–Sun week. */
export const DAYS_MODES = ['all', 'weekEnd'] as const;
export type DaysMode = (typeof DAYS_MODES)[number];

export interface DaysRange {
  from: string;
  to: string;
  mode: DaysMode;
}

export const QUICK_RANGES = [
  { key: 'thisWeek', label: 'This week' },
  { key: 'lastWeek', label: 'Last week' },
  { key: 'last15', label: 'Last 15 days' },
  { key: 'last30', label: 'Last 30 days' },
] as const;
export type QuickRangeKey = (typeof QUICK_RANGES)[number]['key'];

/** A quick range as From → To, never past today (IST). */
export function quickRange(key: QuickRangeKey, today: string): { from: string; to: string } {
  switch (key) {
    case 'thisWeek':
      return { from: sfPresetRange('thisWeek', today)[0], to: today };
    case 'lastWeek': {
      const [from, to] = sfPresetRange('lastWeek', today);
      return { from, to };
    }
    case 'last15':
      return { from: addDaysLocal(today, -14), to: today };
    case 'last30':
      return { from: addDaysLocal(today, -29), to: today };
  }
}

/** The range in the address (or the default: This week, every day), with To
 *  held at today — the server refuses a day that has not come yet. */
export function resolveRange(
  s: { from?: string | undefined; to?: string | undefined; mode?: DaysMode | undefined },
  today: string,
): DaysRange {
  const def = quickRange('thisWeek', today);
  const from = s.from && s.from <= today ? s.from : def.from;
  const to = s.to && s.to <= today ? s.to : today;
  return { from, to, mode: s.mode ?? 'all' };
}

/** Why the range cannot be asked for, or null. */
export function rangeProblem(r: DaysRange): string | null {
  const n = daysBetweenLocal(r.from, r.to);
  if (n === null) return 'Pick a From and a To date.';
  if (n < 0) return 'From must be on or before To.';
  if (n >= SO_JWSO_STATUS_MAX_DAYS) return `Pick at most ${SO_JWSO_STATUS_MAX_DAYS} days.`;
  return null;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dow(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** `Wed` for `2026-11-25`. */
export function weekdayShort(date: string): string {
  return WEEKDAYS[dow(date)] ?? '';
}

/** The Monday of the Mon–Sun week holding `date`. */
export function mondayOf(date: string): string {
  return addDaysLocal(date, -((dow(date) + 6) % 7));
}

/** ISO week number (weeks start Monday; week 1 holds the year's first Thursday). */
export function isoWeekNo(date: string): number {
  const thursday = addDaysLocal(mondayOf(date), 3);
  const jan1 = `${thursday.slice(0, 4)}-01-01`;
  return Math.floor((daysBetweenLocal(jan1, thursday) ?? 0) / 7) + 1;
}

export interface WeekGroup {
  key: string;
  no: number;
  start: string;
  end: string;
  dayCount: number;
}

export interface DayRow {
  key: string;
  date: string;
  kind: OrderKind;
  day: SoJwsoStatusDay;
  summary: OrderStatusSummary | null;
  weekKey: string;
}

/** Days newest first → two rows a day (SO, then JWSO) and the week each sits in.
 *  Week end only keeps the newest day of each week in the range. */
export function buildDayRows(
  days: readonly SoJwsoStatusDay[],
  mode: DaysMode,
): { rows: DayRow[]; weeks: Map<string, WeekGroup> } {
  const sorted = [...days].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const weeks = new Map<string, WeekGroup>();
  const rows: DayRow[] = [];
  for (const day of sorted) {
    const key = mondayOf(day.date);
    const week = weeks.get(key);
    if (week && mode === 'weekEnd') continue;
    if (week) week.dayCount += 1;
    else
      weeks.set(key, {
        key,
        no: isoWeekNo(day.date),
        start: key,
        end: addDaysLocal(key, 6),
        dayCount: 1,
      });
    const none = day.source === 'none';
    rows.push(
      {
        key: `${day.date}-SO`,
        date: day.date,
        kind: 'SO',
        day,
        summary: none ? null : day.so,
        weekKey: key,
      },
      {
        key: `${day.date}-JWSO`,
        date: day.date,
        kind: 'JWSO',
        day,
        summary: none ? null : day.jwso,
        weekKey: key,
      },
    );
  }
  return { rows, weeks };
}

/** "Week 48 · 23-11-2026 to 29-11-2026 (4 days)". */
export function weekHeading(w: WeekGroup): string {
  return `Week ${w.no} · ${fmtDate(w.start)} to ${fmtDate(w.end)} (${w.dayCount} ${w.dayCount === 1 ? 'day' : 'days'})`;
}

/** "live" · "saved 11:50 PM" · "no copy saved". */
export function sourceNote(day: {
  source: SoJwsoStatusDay['source'];
  takenAt: string | null;
}): string {
  if (day.source === 'live') return 'live';
  if (day.source === 'saved') return day.takenAt ? `saved ${fmtTime(day.takenAt)}` : 'saved';
  return 'no copy saved';
}

/** "Wed · saved 11:50 PM" — the small line in the JWSO row's Date cell. */
export function dayNote(day: SoJwsoStatusDay): string {
  return `${weekdayShort(day.date)} · ${sourceNote(day)}`;
}

/** A figure as the screen shows it; no saved copy → "—", never 0. */
export function figureText(f: OrderStatusFigures | null, k: keyof OrderStatusFigures): string {
  return f ? fmtQty(f[k], '—') : '—';
}

/** A figure for Excel / sorting; no saved copy → empty. */
export function figureValue(
  f: OrderStatusFigures | null,
  k: keyof OrderStatusFigures,
): number | null {
  return f ? f[k] : null;
}

/** Sum of one figure over rows (a totals row). */
export function sumFigure<T>(
  rows: readonly T[],
  get: (r: T) => OrderStatusFigures | null,
  k: keyof OrderStatusFigures,
): number {
  return rows.reduce((n, r) => n + (get(r)?.[k] ?? 0), 0);
}
