import { describe, expect, it } from 'vitest';

import { sfDateRange, sfParamSchema, sfPresetRange, sfTodayIst } from './list-query';

describe('sf param', () => {
  it('parses a sort + filters', () => {
    const v = sfParamSchema.parse(
      JSON.stringify({
        sort: { field: 'dueDate', dir: 'desc' },
        filters: [{ field: 'status', kind: 'values', values: ['open'] }],
      }),
    );
    expect(v?.sort).toEqual({ field: 'dueDate', dir: 'desc' });
    expect(v?.filters).toHaveLength(1);
  });
  it('rejects junk, bad fields, unknown ops and too many filters', () => {
    expect(sfParamSchema.safeParse('{').success).toBe(false);
    expect(
      sfParamSchema.safeParse(JSON.stringify({ sort: { field: 'a;drop', dir: 'asc' } })).success,
    ).toBe(false);
    expect(
      sfParamSchema.safeParse(
        JSON.stringify({ filters: [{ field: 'a', kind: 'date', op: 'thisQuarter' }] }),
      ).success,
    ).toBe(false);
    const many = Array.from({ length: 11 }, () => ({
      field: 'a',
      kind: 'text',
      op: 'contains',
      q: 'x',
    }));
    expect(sfParamSchema.safeParse(JSON.stringify({ filters: many })).success).toBe(false);
  });
});

describe('date ranges (IST)', () => {
  it('presets', () => {
    expect(sfPresetRange('thisWeek', '2026-10-01')).toEqual(['2026-09-28', '2026-10-04']);
    expect(sfPresetRange('lastMonth', '2026-01-15')).toEqual(['2025-12-01', '2025-12-31']);
  });
  it('before / after / on / reversed between / stale to', () => {
    expect(sfDateRange('before', '2026-09-28', undefined, 'x')).toEqual({
      from: null,
      to: '2026-09-27',
    });
    expect(sfDateRange('after', '2026-09-28', '2026-09-01', 'x')).toEqual({
      from: '2026-09-29',
      to: null,
    });
    expect(sfDateRange('on', '2026-09-28', undefined, 'x')).toEqual({
      from: '2026-09-28',
      to: '2026-09-28',
    });
    expect(sfDateRange('between', '2026-09-30', '2026-09-01', 'x')).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
    });
  });
  it('today is the India day even late on the UTC day', () => {
    expect(sfTodayIst(new Date('2026-09-30T20:00:00Z'))).toBe('2026-10-01');
  });
});
