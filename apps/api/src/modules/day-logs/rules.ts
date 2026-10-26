// Day Log — small pure helpers the server needs on top of the shared rules
// (packages/shared day-log.ts owns summarizeDay / firstBreakInside / the
// window; nothing here re-states those). No database, unit-tested in
// rules.unit.test.ts.

import {
  DAY_LOG_RULES,
  type DayLogSpan,
  hhmmToMin,
  minToHhmm,
  overlapMin,
  type UserBreakTime,
} from '@innovic/shared';
import { istDateOf } from '../dashboard/personal/util';

const IST_OFFSET_MS = 5.5 * 3600 * 1000;

/** The server's India-time clock: today (YYYY-MM-DD) and minutes since midnight. */
export function istClock(now: number = Date.now()): { today: string; nowMin: number } {
  const d = new Date(now + IST_OFFSET_MS);
  return { today: istDateOf(now), nowMin: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

/** "26-10-2026" — the date as the Day Log messages print it. */
export function dmy(date: string): string {
  return `${date.slice(8, 10)}-${date.slice(5, 7)}-${date.slice(0, 4)}`;
}

/** "HH:MM" from a Postgres time ("09:00:00") — null stays null. */
export function hm(t: string | null | undefined): string | null {
  return t ? t.slice(0, 5) : null;
}

/** Minutes of a closed span; 0 while running. */
export function spanMinutes(fromTime: string | null, toTime: string | null): number {
  if (!fromTime || !toTime) return 0;
  return Math.max(0, hhmmToMin(toTime) - hhmmToMin(fromTime));
}

/** The break whose time contains `min` ([from, to)), if any. */
export function breakAt(spans: readonly DayLogSpan[], min: number): DayLogSpan | null {
  for (const s of spans) {
    if (s.kind !== 'break' || !s.toTime) continue;
    if (min >= hhmmToMin(s.fromTime) && min < hhmmToMin(s.toTime)) return s;
  }
  return null;
}

/**
 * First unlogged slot inside the work window, "HH:MM – HH:MM", or null.
 * Breaks and work entries both cover time; a running entry covers up to
 * `nowMin` (or only its start minute when no clock is given).
 */
export function firstGap(spans: readonly DayLogSpan[], nowMin?: number): string | null {
  const w1 = hhmmToMin(DAY_LOG_RULES.workFrom);
  const w2 = hhmmToMin(DAY_LOG_RULES.workTo);
  const covered = spans
    .map((s) => {
      const a = hhmmToMin(s.fromTime);
      const b = s.toTime ? hhmmToMin(s.toTime) : Math.max(a, nowMin ?? a);
      return [a, b] as const;
    })
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let at = w1;
  for (const [a, b] of covered) {
    if (a > at) {
      const end = Math.min(a, w2);
      if (end > at) return `${minToHhmm(at)} – ${minToHhmm(end)}`;
    }
    at = Math.max(at, b);
    if (at >= w2) return null;
  }
  return at < w2 ? `${minToHhmm(at)} – ${minToHhmm(w2)}` : null;
}

/**
 * A user's break template: each break inside the work window, no two
 * overlapping, total within DAY_LOG_RULES.breakLimitMin. Returns the refusal
 * message, or null when the set is fine.
 */
export function breakTemplateProblem(breaks: readonly UserBreakTime[]): string | null {
  const w1 = hhmmToMin(DAY_LOG_RULES.workFrom);
  const w2 = hhmmToMin(DAY_LOG_RULES.workTo);
  const sorted = [...breaks].sort((a, b) => hhmmToMin(a.fromTime) - hhmmToMin(b.fromTime));
  let total = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    const b = sorted[i]!;
    const a1 = hhmmToMin(b.fromTime);
    const a2 = hhmmToMin(b.toTime);
    if (a2 <= a1) return `${b.name}: To must be after From`;
    if (a1 < w1 || a2 > w2) {
      return `${b.name} ${b.fromTime}–${b.toTime} must be inside ${DAY_LOG_RULES.workFrom}–${DAY_LOG_RULES.workTo}`;
    }
    const prev = sorted[i - 1];
    if (prev && overlapMin(hhmmToMin(prev.fromTime), hhmmToMin(prev.toTime), a1, a2) > 0) {
      return `${prev.name} and ${b.name} overlap`;
    }
    total += a2 - a1;
  }
  if (total > DAY_LOG_RULES.breakLimitMin) {
    return `Breaks add up to ${total} minutes — the limit is ${DAY_LOG_RULES.breakLimitMin}`;
  }
  return null;
}
