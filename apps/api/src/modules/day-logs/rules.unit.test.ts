// Day Log pure helpers (rules.ts) — no database.
import { describe, expect, it } from 'vitest';
import type { DayLine } from './day';
import {
  blockedByOf,
  currentOf,
  dmy,
  dmyDay,
  entryMinutes,
  findOverlap,
  hm,
  istClock,
  latestWorkOf,
  spanEnd,
} from './rules';

const lunch = { kind: 'break' as const, fromTime: '13:00', toTime: '13:30' };
const work = (fromTime: string, toTime: string | null) => ({
  kind: 'work' as const,
  fromTime,
  toTime,
});
const withId = (s: { kind: 'work' | 'break'; fromTime: string; toTime: string | null }) => ({
  ...s,
  id: `${s.fromTime}`,
  description: s.kind === 'break' ? 'Lunch' : 'job',
});
const line = (
  kind: 'work' | 'break' | 'leave',
  fromTime: string,
  toTime: string | null,
  description = 'job',
  code: string | null = null,
): DayLine => ({
  id: fromTime,
  reportId: 'r',
  kind,
  fromTime,
  toTime,
  description,
  remarks: null,
  order: code ? { type: 'so', id: '00000000-0000-0000-0000-000000000000', code } : null,
  late: false,
  updatedAt: '',
  pending: null,
  rejectReason: null,
});

describe('istClock', () => {
  it('is India time: 2026-10-26 20:00 UTC is 27-Oct 01:30 IST', () => {
    expect(istClock(Date.UTC(2026, 9, 26, 20, 0))).toEqual({ today: '2026-10-27', nowMin: 90 });
  });
  it('03:30 UTC is 09:00 IST the same day', () => {
    expect(istClock(Date.UTC(2026, 9, 26, 3, 30))).toEqual({ today: '2026-10-26', nowMin: 540 });
  });
});

describe('formatting', () => {
  it('dmy / hm', () => {
    expect(dmy('2026-10-26')).toBe('26-10-2026');
    expect(hm('09:05:00')).toBe('09:05');
    expect(hm(null)).toBeNull();
  });
});

describe('spanEnd / entryMinutes', () => {
  it('closed entry ends at its Stop', () => {
    expect(spanEnd('09:00', '10:15')).toBe(615);
    expect(entryMinutes('09:00', '10:15')).toBe(75);
  });
  it('Open today runs to now (at least its start minute)', () => {
    expect(spanEnd('09:00', null, 600)).toBe(600);
    expect(spanEnd('10:00', null, 600)).toBe(601);
    expect(entryMinutes('09:00', null, 600)).toBe(60);
  });
  it('Open on an earlier day runs to the end of the day, counts 0 minutes', () => {
    expect(spanEnd('17:00', null)).toBe(1440);
    expect(entryMinutes('17:00', null)).toBe(0);
  });
});

describe('findOverlap', () => {
  const day = [withId(work('09:00', '10:00')), withId(lunch)];
  it('touching ends do not overlap', () => {
    expect(findOverlap(day, { fromTime: '10:00', toTime: '13:00' })).toBeNull();
  });
  it('sharing a minute overlaps (work or break)', () => {
    expect(findOverlap(day, { fromTime: '09:59', toTime: '10:30' })?.fromTime).toBe('09:00');
    expect(findOverlap(day, { fromTime: '12:00', toTime: '13:01' })?.fromTime).toBe('13:00');
  });
  it('an Open candidate today covers its start to now', () => {
    expect(findOverlap(day, { fromTime: '11:00', toTime: null }, 14 * 60)?.kind).toBe('break');
    expect(findOverlap(day, { fromTime: '11:00', toTime: null }, 12 * 60)).toBeNull();
  });
  it('an Open entry already there blocks anything after its start', () => {
    const open = [withId(work('11:00', null))];
    expect(findOverlap(open, { fromTime: '11:30', toTime: '11:40' }, 12 * 60)).not.toBeNull();
    expect(findOverlap(open, { fromTime: '10:00', toTime: '11:00' }, 12 * 60)).toBeNull();
  });
});

describe('yesterday first', () => {
  it('blocks only when an earlier row exists and the calendar day before is empty', () => {
    expect(blockedByOf({ hasEarlier: false, prevHasRows: false }, '2026-10-27')).toBeNull();
    expect(blockedByOf({ hasEarlier: true, prevHasRows: true }, '2026-10-27')).toBeNull();
    // Monday 2026-10-26 is blocked by Sunday 25-10 — Sundays are not skipped.
    expect(blockedByOf({ hasEarlier: true, prevHasRows: false }, '2026-10-26')).toEqual({
      date: '2026-10-25',
      reason: '25-10-2026 (Sun) has no entries — fill it first',
    });
  });
  it('dmyDay names the weekday', () => {
    expect(dmyDay('2026-10-26')).toBe('26-10-2026 (Mon)');
  });
});

describe('Team current status', () => {
  const day = [line('work', '09:00', '14:30', 'GRN')];
  it('today: working within 30 min of the latest Stop, then idle; none = not started', () => {
    expect(currentOf(day, true, '14:30', 15 * 60)).toEqual({
      status: 'working',
      text: 'till 02:30 PM',
      since: null,
    });
    expect(currentOf(day, true, '14:30', 15 * 60 + 1)).toEqual({
      status: 'idle',
      text: 'since 02:30 PM',
      since: null,
    });
    expect(currentOf([], true, null, 600).status).toBe('not_started');
  });
  it('a past day: idle (Logged) with entries, else not started', () => {
    expect(currentOf(day, false, '14:30')).toEqual({ status: 'idle', text: null, since: null });
    expect(currentOf([], false, null).status).toBe('not_started');
  });
  it('latest work: an old Open one, else the latest-starting', () => {
    expect(
      latestWorkOf([
        line('work', '09:00', '10:00', 'a', 'IN-SO-1'),
        line('work', '10:00', '11:00', 'b'),
      ]),
    ).toEqual({ description: 'b', orderCode: null });
    expect(
      latestWorkOf([
        line('work', '09:00', null, 'a', 'IN-SO-1'),
        line('work', '10:00', '11:00', 'b'),
      ]),
    ).toEqual({ description: 'a', orderCode: 'IN-SO-1' });
    expect(latestWorkOf([])).toBeNull();
  });
});
