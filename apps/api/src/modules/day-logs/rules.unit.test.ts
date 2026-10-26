// Day Log pure helpers (rules.ts) — no database.
import { describe, expect, it } from 'vitest';
import type { DayLine } from './day';
import {
  breakLimitProblem,
  breakTotalWith,
  dmy,
  entryMinutes,
  findOverlap,
  firstGap,
  hm,
  istClock,
  currentOf,
  lastEntryOf,
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
  kind: 'work' | 'break',
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

describe('breaks', () => {
  it('totals closed and Open breaks (to now)', () => {
    expect(
      breakTotalWith([lunch], { kind: 'break', fromTime: '16:00', toTime: null }, 16 * 60 + 20),
    ).toBe(50);
    expect(breakTotalWith([lunch], { kind: 'work', fromTime: '09:00', toTime: '10:00' })).toBe(30);
  });
  it('refuses over the limit only', () => {
    expect(breakLimitProblem(60)).toBeNull();
    expect(breakLimitProblem(61)).toMatch(/limit is 60/);
  });
});

describe('lastEntryOf (strict order)', () => {
  it('the latest-starting timed entry; untimed lines ignored', () => {
    const a = withId(work('09:00', '10:00'));
    const b = withId(work('10:00', '11:30'));
    expect(lastEntryOf([b, a])).toBe(b);
    expect(lastEntryOf([a, { ...b, fromTime: null }])).toBe(a);
    expect(lastEntryOf([])).toBeNull();
  });
});

describe('firstGap', () => {
  it('whole window when nothing is logged', () => {
    expect(firstGap([])).toBe('09:00 AM – 06:00 PM');
  });
  it('the slot before a break', () => {
    expect(firstGap([work('09:00', '11:00'), lunch])).toBe('11:00 AM – 01:00 PM');
  });
  it('null when the day is covered', () => {
    expect(firstGap([work('09:00', '13:00'), lunch, work('13:30', '18:00')])).toBeNull();
  });
  it('an Open entry covers up to now', () => {
    expect(firstGap([work('09:00', null)], 10 * 60)).toBe('10:00 AM – 06:00 PM');
  });
  it('a hole in the middle', () => {
    expect(firstGap([work('09:00', '10:00'), work('10:30', '18:00')])).toBe('10:00 AM – 10:30 AM');
  });
});

describe('Team current status', () => {
  it('working / break / idle / not_started today', () => {
    expect(currentOf('open', [line('work', '09:00', null, 'GRN')], null, true, null)).toEqual({
      status: 'working',
      text: 'GRN · since 09:00 AM',
      since: '09:00',
    });
    expect(currentOf('open', [line('break', '13:05', null, 'Lunch')], null, true, null).text).toBe(
      'Lunch since 01:05 PM',
    );
    expect(currentOf('open', [line('work', '09:00', '11:00')], null, true, '11:00').text).toBe(
      'since 11:00 AM',
    );
    expect(currentOf('open', [], null, true, null).status).toBe('not_started');
  });
  it('a past day: idle / not_started with no text; submitted / leave from the day', () => {
    expect(currentOf('open', [line('work', '09:00', '11:00')], null, false, '11:00')).toEqual({
      status: 'idle',
      text: null,
      since: null,
    });
    expect(currentOf('open', [], null, false, null).status).toBe('not_started');
    expect(currentOf('submitted', [], '2026-10-26T12:30:00Z', false, null)).toEqual({
      status: 'submitted',
      text: null,
      since: null,
    });
    expect(currentOf('leave', [], null, true, null).status).toBe('leave');
  });
  it('latest work: the Open one, else the latest-starting', () => {
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
    expect(latestWorkOf([line('break', '13:00', '13:30')])).toBeNull();
  });
});
