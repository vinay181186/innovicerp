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

/** Both kinds, or only SO / only JWSO — on the list, the day page, Excel and print. */
export const SHOW_KINDS = ['all', 'SO', 'JWSO'] as const;
export type ShowKind = (typeof SHOW_KINDS)[number];

export const SHOW_OPTIONS: { value: ShowKind; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'SO', label: 'SO' },
  { value: 'JWSO', label: 'JWSO' },
];

/** The Home view keeps its Show choice per browser tab under this key; the day
 *  page opened from Home writes it too, so Back returns to the same Show. */
export const HOME_SHOW_KEY = 'so-jwso-home:show';

/** Is this kind shown under the Show filter? */
export function showsKind(show: ShowKind, kind: OrderKind): boolean {
  return show === 'all' || show === kind;
}

export interface DaysRange {
  from: string;
  to: string;
  mode: DaysMode;
  show: ShowKind;
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
  s: {
    from?: string | undefined;
    to?: string | undefined;
    mode?: DaysMode | undefined;
    show?: ShowKind | undefined;
  },
  today: string,
): DaysRange {
  const def = quickRange('thisWeek', today);
  const from = s.from && s.from <= today ? s.from : def.from;
  const to = s.to && s.to <= today ? s.to : today;
  return { from, to, mode: s.mode ?? 'all', show: s.show ?? 'all' };
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

/** "23-11-2026 Mon" — the days list's Date cell. */
export function dateWithDay(date: string): string {
  return `${fmtDate(date)} ${weekdayShort(date)}`;
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
  /** The server's day; null for a day of this week still to come. */
  day: SoJwsoStatusDay | null;
  summary: OrderStatusSummary | null;
  weekKey: string;
  /** The day's first row on screen — it carries the date and opens the day. */
  first: boolean;
  /** A day of this week still to come: "—" and never opens. */
  future: boolean;
}

/** Days newest first → a row per shown kind a day (SO, then JWSO) and the week
 *  each sits in. When To is today, the week runs to Sunday: this week's days
 *  still to come are added as "—" rows (the server never sends a future day).
 *  Week end only keeps the newest day of each week, so this week shows today,
 *  not the Sunday still to come. */
export function buildDayRows(
  days: readonly SoJwsoStatusDay[],
  range: DaysRange,
  today: string,
): { rows: DayRow[]; weeks: Map<string, WeekGroup>; dayCount: number } {
  const all: { date: string; day: SoJwsoStatusDay | null }[] = days.map((day) => ({
    date: day.date,
    day,
  }));
  // Only once the loaded days reach today — not while the previous range's
  // days are still on screen during a load.
  const reachesToday = days.some((d) => d.date === today);
  if (range.mode === 'all' && range.to === today && reachesToday) {
    const sunday = addDaysLocal(mondayOf(today), 6);
    for (let d = addDaysLocal(today, 1); d <= sunday; d = addDaysLocal(d, 1))
      all.push({ date: d, day: null });
  }
  all.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const kinds = (['SO', 'JWSO'] as const).filter((k) => showsKind(range.show, k));
  const weeks = new Map<string, WeekGroup>();
  const rows: DayRow[] = [];
  let dayCount = 0;
  for (const { date, day } of all) {
    const key = mondayOf(date);
    const week = weeks.get(key);
    if (week && range.mode === 'weekEnd') continue;
    if (week) week.dayCount += 1;
    else
      weeks.set(key, {
        key,
        no: isoWeekNo(date),
        start: key,
        end: addDaysLocal(key, 6),
        dayCount: 1,
      });
    dayCount += 1;
    kinds.forEach((kind, i) => {
      const summary = !day || day.source === 'none' ? null : kind === 'SO' ? day.so : day.jwso;
      rows.push({
        key: `${date}-${kind}`,
        date,
        kind,
        day,
        summary,
        weekKey: key,
        first: i === 0,
        future: day === null,
      });
    });
  }
  return { rows, weeks, dayCount };
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
