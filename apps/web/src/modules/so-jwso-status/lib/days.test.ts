import type { SoJwsoStatusDay } from '@innovic/shared';
import { describe, expect, it } from 'vitest';
import { type DaysRange, buildDayRows, dateWithDay, resolveRange } from './days';

// Two days of week 48 (Thu 26-11, Fri 27-11) and one of week 47 (Sun 22-11).
const day = (date: string, source: SoJwsoStatusDay['source'] = 'saved'): SoJwsoStatusDay =>
  ({ date, source, takenAt: null, so: { orders: 1 }, jwso: { orders: 2 } }) as SoJwsoStatusDay;
const DAYS = [day('2026-11-22'), day('2026-11-26'), day('2026-11-27', 'live')];
const range = (p: Partial<DaysRange>): DaysRange => ({
  from: '2026-11-22',
  to: '2026-11-27',
  mode: 'all',
  show: 'all',
  ...p,
});

describe('buildDayRows (ADR-326)', () => {
  it('All: an SO then a JWSO row a day; only the first carries the date', () => {
    const { rows, dayCount } = buildDayRows(DAYS, range({}), '2026-11-28');
    expect(dayCount).toBe(3);
    expect(rows.map((r) => `${r.date.slice(8)}${r.kind}${r.first ? '*' : ''}`)).toEqual([
      '27SO*',
      '27JWSO',
      '26SO*',
      '26JWSO',
      '22SO*',
      '22JWSO',
    ]);
  });

  it('Show JWSO: one row a day, the JWSO row carries the date', () => {
    const { rows, dayCount } = buildDayRows(DAYS, range({ show: 'JWSO' }), '2026-11-28');
    expect(dayCount).toBe(3);
    expect(rows.every((r) => r.kind === 'JWSO' && r.first)).toBe(true);
    expect(rows[0]?.summary?.orders).toBe(2);
  });

  it('To = today: the week runs to Sunday with "—" rows that never open', () => {
    const { rows, weeks, dayCount } = buildDayRows(DAYS, range({}), '2026-11-27');
    const future = rows.filter((r) => r.future);
    expect(future.map((r) => r.date)).toEqual([
      '2026-11-29',
      '2026-11-29',
      '2026-11-28',
      '2026-11-28',
    ]);
    expect(future.every((r) => r.summary === null && r.day === null)).toBe(true);
    expect(dayCount).toBe(5);
    expect(weeks.get('2026-11-23')?.dayCount).toBe(4);
  });

  it('Week end only: the newest day per week, never a day still to come', () => {
    const { rows, dayCount } = buildDayRows(
      DAYS,
      range({ mode: 'weekEnd', show: 'SO' }),
      '2026-11-27',
    );
    expect(dayCount).toBe(2);
    expect(rows.map((r) => r.date)).toEqual(['2026-11-27', '2026-11-22']);
  });

  it('a day with no copy saved shows no figures', () => {
    const { rows } = buildDayRows([day('2026-11-23', 'none')], range({}), '2026-11-28');
    expect(rows.every((r) => r.summary === null && !r.future)).toBe(true);
  });
});

describe('resolveRange / dateWithDay', () => {
  it('an unknown or missing Show is All', () => {
    expect(resolveRange({}, '2026-11-28').show).toBe('all');
    expect(resolveRange({ show: 'SO' }, '2026-11-28').show).toBe('SO');
  });
  it('"23-11-2026 Mon"', () => {
    expect(dateWithDay('2026-11-23')).toBe('23-11-2026 Mon');
  });
});
