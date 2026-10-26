// Day Log pure helpers (rules.ts) — no database.
import { describe, expect, it } from 'vitest';
import { breakAt, breakTemplateProblem, dmy, firstGap, hm, istClock, spanMinutes } from './rules';

const lunch = { kind: 'break' as const, fromTime: '13:00', toTime: '13:30' };
const work = (fromTime: string, toTime: string | null) => ({
  kind: 'work' as const,
  fromTime,
  toTime,
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
  it('dmy / hm / spanMinutes', () => {
    expect(dmy('2026-10-26')).toBe('26-10-2026');
    expect(hm('09:05:00')).toBe('09:05');
    expect(hm(null)).toBeNull();
    expect(spanMinutes('09:00', '10:15')).toBe(75);
    expect(spanMinutes('09:00', null)).toBe(0);
  });
});

describe('breakAt', () => {
  it('finds the break containing a minute, [from, to)', () => {
    expect(breakAt([lunch], 13 * 60)).toBe(lunch);
    expect(breakAt([lunch], 13 * 60 + 29)).toBe(lunch);
    expect(breakAt([lunch], 13 * 60 + 30)).toBeNull();
    expect(breakAt([work('12:00', '13:00')], 12 * 60 + 30)).toBeNull();
  });
});

describe('firstGap', () => {
  it('whole window when nothing is logged', () => {
    expect(firstGap([])).toBe('09:00 – 18:00');
  });
  it('the slot before a break', () => {
    expect(firstGap([work('09:00', '11:00'), lunch])).toBe('11:00 – 13:00');
  });
  it('after the break when the morning is done', () => {
    expect(firstGap([work('09:00', '13:00'), lunch, work('13:30', '14:00')])).toBe('14:00 – 18:00');
  });
  it('null when the day is covered', () => {
    expect(firstGap([work('09:00', '13:00'), lunch, work('13:30', '18:00')])).toBeNull();
  });
  it('a running entry covers up to now', () => {
    expect(firstGap([work('09:00', null)], 10 * 60)).toBe('10:00 – 18:00');
  });
  it('a hole in the middle', () => {
    expect(firstGap([work('09:00', '10:00'), work('10:30', '18:00')])).toBe('10:00 – 10:30');
  });
});

describe('breakTemplateProblem', () => {
  it('accepts a normal template', () => {
    expect(
      breakTemplateProblem([
        { name: 'Tea', fromTime: '11:00', toTime: '11:15' },
        { name: 'Lunch', fromTime: '13:00', toTime: '13:30' },
      ]),
    ).toBeNull();
  });
  it('refuses a break outside the window', () => {
    expect(breakTemplateProblem([{ name: 'Late', fromTime: '17:45', toTime: '18:15' }])).toMatch(
      /inside 09:00–18:00/,
    );
  });
  it('refuses overlapping breaks', () => {
    expect(
      breakTemplateProblem([
        { name: 'Lunch', fromTime: '13:00', toTime: '13:30' },
        { name: 'Tea', fromTime: '13:15', toTime: '13:45' },
      ]),
    ).toMatch(/overlap/);
  });
  it('refuses more than the limit', () => {
    expect(
      breakTemplateProblem([
        { name: 'Lunch', fromTime: '13:00', toTime: '13:45' },
        { name: 'Tea', fromTime: '16:00', toTime: '16:20' },
      ]),
    ).toMatch(/limit is 60/);
  });
});
