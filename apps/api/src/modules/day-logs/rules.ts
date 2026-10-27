// Day Log — small pure helpers the server needs on top of the shared rules
// (packages/shared day-log.ts owns summarizeDay / the window; nothing here
// re-states those). No database, unit-tested in rules.unit.test.ts.

import {
  type DayLogCurrentStatus,
  type DayLogSpan,
  fmt12,
  hhmmToMin,
  overlapMin,
} from '@innovic/shared';
import { addDays, istDateOf } from '../dashboard/personal/util';
import type { DayLine } from './day';

const IST_OFFSET_MS = 5.5 * 3600 * 1000;
const DAY_END_MIN = 24 * 60;

/** India-time "today" (YYYY-MM-DD) and minutes since midnight. Writes take an
 *  optional clock only so the DB tests run at a fixed time; routes never pass one. */
export type DayLogClock = { today: string; nowMin: number };

/** The server's India-time clock. */
export function istClock(now: number = Date.now()): DayLogClock {
  const d = new Date(now + IST_OFFSET_MS);
  return { today: istDateOf(now), nowMin: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

/** "26-10-2026" — the date as the Day Log messages print it. */
export function dmy(date: string): string {
  return `${date.slice(8, 10)}-${date.slice(5, 7)}-${date.slice(0, 4)}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** "26-10-2026 (Mon)". */
export const dmyDay = (date: string): string =>
  `${dmy(date)} (${WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]})`;

/** Team "Working": the latest Stop is at most this many minutes before now. */
export const WORKING_WINDOW_MIN = 30;

/** "HH:MM" from a Postgres time ("09:00:00") — null stays null. */
export function hm(t: string | null | undefined): string | null {
  return t ? t.slice(0, 5) : null;
}

/** "HH:MM" India time of an ISO timestamp. */
export const istHm = (iso: string): string =>
  new Date(new Date(iso).getTime() + IST_OFFSET_MS).toISOString().slice(11, 16);

/**
 * Where an entry ends, in minutes. Closed: its Stop. Open: now on today (at
 * least one minute past its start, so it always occupies its start), the
 * end of the day on an earlier day (`nowMin` undefined).
 */
export function spanEnd(fromTime: string, toTime: string | null, nowMin?: number): number {
  if (toTime) return hhmmToMin(toTime);
  const a = hhmmToMin(fromTime);
  return nowMin === undefined ? DAY_END_MIN : Math.max(a + 1, nowMin);
}

/** Minutes an entry has run: an Open entry counts to now on today, 0 on an
 *  earlier day. */
export function entryMinutes(fromTime: string, toTime: string | null, nowMin?: number): number {
  if (!toTime && nowMin === undefined) return 0;
  const a = hhmmToMin(fromTime);
  const b = toTime ? hhmmToMin(toTime) : Math.max(a, nowMin ?? a);
  return Math.max(0, b - a);
}

export interface SpanWithId extends DayLogSpan {
  id: string;
  description: string;
}

/** The first other entry that shares time with [fromTime, toTime). */
export function findOverlap(
  others: readonly SpanWithId[],
  cand: { fromTime: string; toTime: string | null },
  nowMin?: number,
): SpanWithId | null {
  const a = hhmmToMin(cand.fromTime);
  const b = spanEnd(cand.fromTime, cand.toTime, nowMin);
  for (const o of others) {
    if (overlapMin(a, b, hhmmToMin(o.fromTime), spanEnd(o.fromTime, o.toTime, nowMin)) > 0)
      return o;
  }
  return null;
}

/**
 * YESTERDAY FIRST (owner 2026-10-27): a day can be written only when the
 * PREVIOUS CALENDAR DAY has at least one saved row — no skipping Sundays or
 * holidays (the user writes "Sunday" / "Holiday"). Never blocks a person
 * with no saved row before `date` at all (their very first day).
 */
export function blockedByOf(
  snap: { hasEarlier: boolean; prevHasRows: boolean },
  date: string,
): { date: string; reason: string } | null {
  if (!snap.hasEarlier || snap.prevHasRows) return null;
  const prev = addDays(date, -1);
  return { date: prev, reason: `${dmyDay(prev)} has no entries — fill it first` };
}

// ── Team Day Logs ───────────────────────────────────────────────────────────

/** Team "Now" (owner 2026-10-27): today — Working when the latest Stop is
 *  within WORKING_WINDOW_MIN of now ("till 02:30 PM"), Idle with entries
 *  ("since …"), Not started with none. A past day: Idle (Logged) when it has
 *  entries, else Not started. Day statuses (submit / leave) are not used. */
export function currentOf(
  lines: readonly DayLine[],
  today: boolean,
  lastStop: string | null,
  nowMin?: number,
): { status: DayLogCurrentStatus; text: string | null; since: string | null } {
  const timed = lines.filter((l) => l.fromTime);
  if (!timed.length) return { status: 'not_started', text: null, since: null };
  if (!today || nowMin === undefined || !lastStop)
    return { status: 'idle', text: null, since: null };
  if (nowMin - hhmmToMin(lastStop) <= WORKING_WINDOW_MIN) {
    return { status: 'working', text: `till ${fmt12(lastStop)}`, since: null };
  }
  return { status: 'idle', text: `since ${fmt12(lastStop)}`, since: null };
}

/** The latest-starting entry (an old Open one first). */
export function latestWorkOf(
  lines: readonly DayLine[],
): { description: string; orderCode: string | null } | null {
  const timed = lines.filter((l) => l.fromTime);
  const pick =
    timed.find((l) => !l.toTime) ??
    [...timed].sort((a, b) => (a.fromTime! < b.fromTime! ? 1 : -1))[0];
  return pick ? { description: pick.description, orderCode: pick.order?.code ?? null } : null;
}
