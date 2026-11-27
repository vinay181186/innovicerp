// ADR-325 — the pure rules behind GET /so-jwso-status/days and /day/:date.
// No database: run with `pnpm --filter @innovic/api test:unit`.
import type { OrderStatusRow } from '@innovic/shared';
import { describe, expect, it } from 'vitest';
import {
  dayCount,
  dayProblem,
  daySource,
  daysNewestFirst,
  rangeProblem,
  summarise,
} from './day-rules';

const row = (kind: 'SO' | 'JWSO', over: Partial<OrderStatusRow> = {}): OrderStatusRow => ({
  orderKind: kind,
  orderId: '00000000-0000-4000-8000-000000000001',
  orderCode: kind === 'SO' ? 'SO-436' : 'IN-JWSO-00001',
  totalLines: 7,
  totalPlans: 9,
  totalRc: 6,
  proReleased: 5,
  jcReleased: 5,
  jcNotStarted: 0,
  jcRunning: 5,
  jcClosed: 0,
  proClosed: 0,
  dispatchQty: 0.1,
  physicalStock: 0.2,
  ...over,
});

describe('rangeProblem', () => {
  const today = '2026-11-27';
  it('accepts a range ending today', () => {
    expect(rangeProblem('2026-11-01', today, today)).toBeNull();
  });
  it('refuses To after today', () => {
    expect(rangeProblem('2026-11-01', '2026-11-28', today)).toMatch(/after today/);
  });
  it('refuses From after To', () => {
    expect(rangeProblem('2026-11-10', '2026-11-01', today)).toMatch(/From must be/);
  });
  it('allows exactly 92 days and refuses 93', () => {
    expect(dayCount('2026-08-28', today)).toBe(92);
    expect(rangeProblem('2026-08-28', today, today)).toBeNull();
    expect(rangeProblem('2026-08-27', today, today)).toMatch(/at most 92/);
  });
  it('refuses an impossible date', () => {
    expect(rangeProblem('2026-13-40', today, today)).toMatch(/real dates/);
  });
});

describe('dayProblem', () => {
  it('refuses a future day, accepts today and the past', () => {
    expect(dayProblem('2026-11-28', '2026-11-27')).toMatch(/after today/);
    expect(dayProblem('2026-11-27', '2026-11-27')).toBeNull();
    expect(dayProblem('2026-01-01', '2026-11-27')).toBeNull();
  });
});

describe('daySource', () => {
  it('today is live even without a saved copy', () => {
    expect(daySource('2026-11-27', '2026-11-27', false)).toBe('live');
    expect(daySource('2026-11-27', '2026-11-27', true)).toBe('live');
  });
  it('a past day is saved when rows exist, none otherwise', () => {
    expect(daySource('2026-11-26', '2026-11-27', true)).toBe('saved');
    expect(daySource('2026-11-26', '2026-11-27', false)).toBe('none');
  });
});

describe('daysNewestFirst', () => {
  it('lists To down to From, across a month end', () => {
    expect(daysNewestFirst('2026-10-30', '2026-11-02')).toEqual([
      '2026-11-02',
      '2026-11-01',
      '2026-10-31',
      '2026-10-30',
    ]);
  });
});

describe('summarise', () => {
  it('sums one type only and counts its orders', () => {
    const rows = [row('SO'), row('SO', { jcRunning: 3, jcNotStarted: 2 }), row('JWSO')];
    const so = summarise(rows, 'SO');
    expect(so.orders).toBe(2);
    expect(so.totalLines).toBe(14);
    expect(so.jcReleased).toBe(10);
    expect(so.jcRunning).toBe(8);
    expect(so.jcNotStarted).toBe(2);
    expect(so.jcNotStarted + so.jcRunning + so.jcClosed).toBe(so.jcReleased);
    expect(summarise(rows, 'JWSO').orders).toBe(1);
  });
  it('rounds qty sums to 3 decimals (no float drift)', () => {
    const so = summarise([row('SO'), row('SO')], 'SO');
    expect(so.dispatchQty).toBe(0.2);
    expect(so.physicalStock).toBe(0.4);
  });
  it('gives all zeros for a type with no orders', () => {
    const s = summarise([row('SO')], 'JWSO');
    expect(s.orders).toBe(0);
    expect(s.totalLines).toBe(0);
    expect(s.dispatchQty).toBe(0);
  });
});
