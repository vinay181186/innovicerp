// Day Log — small pure helpers the server needs on top of the shared rules
// (packages/shared day-log.ts owns summarizeDay / the window; nothing here
// re-states those). No database, unit-tested in rules.unit.test.ts.

import {
  DAY_LOG_RULES,
  type DayLogCurrentStatus,
  type DayLogEntryKind,
  type DayLogStatus,
  type DayLogSpan,
  fmt12,
  hhmmToMin,
  minToHhmm,
  overlapMin,
} from '@innovic/shared';
import { istDateOf } from '../dashboard/personal/util';
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

/** Break minutes of the day if `cand` is saved (Open breaks count to now). */
export function breakTotalWith(
  others: readonly DayLogSpan[],
  cand: { kind: DayLogEntryKind; fromTime: string; toTime: string | null },
  nowMin?: number,
): number {
  let total = 0;
  for (const s of [...others, cand]) {
    if (s.kind === 'break') total += entryMinutes(s.fromTime, s.toTime, nowMin);
  }
  return total;
}

/** The refusal when the day's breaks would pass the limit, else null. */
export function breakLimitProblem(total: number): string | null {
  return total > DAY_LOG_RULES.breakLimitMin
    ? `Breaks would add up to ${total} minutes — the limit is ${DAY_LOG_RULES.breakLimitMin} a day`
    : null;
}

/**
 * Strict order (owner 2026-10-26): the latest-starting timed entry — the only
 * one whose times may change or that may be removed. A tie (legacy data)
 * goes to the later Stop, an Open entry counting as latest.
 */
export function lastEntryOf<T extends { fromTime: string | null; toTime: string | null }>(
  lines: readonly T[],
): T | null {
  const end = (l: T): number => (l.toTime ? hhmmToMin(l.toTime) : DAY_END_MIN);
  let best: T | null = null;
  for (const l of lines) {
    if (!l.fromTime) continue;
    if (
      !best ||
      l.fromTime > best.fromTime! ||
      (l.fromTime === best.fromTime && end(l) >= end(best))
    )
      best = l;
  }
  return best;
}

/**
 * First unlogged slot inside the work window, "09:00 AM – 06:00 PM", or null.
 * Breaks and work entries both cover time; an Open entry covers up to
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
      if (end > at) return `${fmt12(minToHhmm(at))} – ${fmt12(minToHhmm(end))}`;
    }
    at = Math.max(at, b);
    if (at >= w2) return null;
  }
  return at < w2 ? `${fmt12(minToHhmm(at))} – ${fmt12(minToHhmm(w2))}` : null;
}

// ── Team Day Logs ───────────────────────────────────────────────────────────

/** What the person is doing. `today` = the date is today (else a past day:
 *  its day status, else idle / not_started, no text). A Leave entry whose
 *  Start has come (`nowMin`, today only) reads Leave — even on a day already
 *  submitted, since the person submits before leaving. */
export function currentOf(
  status: DayLogStatus,
  lines: readonly DayLine[],
  submittedAt: string | null,
  today: boolean,
  lastStop: string | null,
  nowMin?: number,
): { status: DayLogCurrentStatus; text: string | null; since: string | null } {
  const leave = today ? lines.find((l) => l.kind === 'leave' && l.fromTime) : undefined;
  if (leave && nowMin !== undefined && nowMin >= hhmmToMin(leave.fromTime!)) {
    return { status: 'leave', text: `from ${fmt12(leave.fromTime!)}`, since: null };
  }
  if (status === 'submitted') {
    return {
      status: 'submitted',
      text: today && submittedAt ? fmt12(istHm(submittedAt)) : null,
      since: null,
    };
  }
  if (status === 'leave') return { status: 'leave', text: null, since: null };
  const timed = lines.filter((l) => l.fromTime);
  if (!today) return { status: timed.length ? 'idle' : 'not_started', text: null, since: null };
  const open = timed.find((l) => !l.toTime);
  if (open?.kind === 'work') {
    return {
      status: 'working',
      text: `${open.description} · since ${fmt12(open.fromTime)}`,
      since: open.fromTime,
    };
  }
  if (open) {
    return {
      status: 'break',
      text: `${open.description} since ${fmt12(open.fromTime)}`,
      since: open.fromTime,
    };
  }
  if (timed.length)
    return { status: 'idle', text: lastStop ? `since ${fmt12(lastStop)}` : null, since: null };
  return { status: 'not_started', text: null, since: null };
}

/** The Open work entry, else the latest-starting work entry. */
export function latestWorkOf(
  lines: readonly DayLine[],
): { description: string; orderCode: string | null } | null {
  const work = lines.filter((l) => l.kind === 'work' && l.fromTime);
  const pick =
    work.find((l) => !l.toTime) ??
    [...work].sort((a, b) => (a.fromTime! < b.fromTime! ? 1 : -1))[0];
  return pick ? { description: pick.description, orderCode: pick.order?.code ?? null } : null;
}
