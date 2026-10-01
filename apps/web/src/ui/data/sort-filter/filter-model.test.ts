import { describe, expect, it } from 'vitest';

import {
  BLANK,
  applySortFilter,
  detectType,
  distinctValues,
  matches,
  normText,
  parseDate,
  parseNum,
  presetRange,
  sanitizeState,
  type SfColumn,
} from './filter-model';

const TODAY = '2026-10-01'; // a Thursday

describe('parsing displayed values', () => {
  it('reads the app date format and the other common ones', () => {
    expect(parseDate('26-Sep-2026')).toBe('2026-09-26');
    expect(parseDate('26-Sep-2026 14:05')).toBe('2026-09-26');
    expect(parseDate('05-10-2026')).toBe('2026-10-05');
    expect(parseDate('5/10/2026')).toBe('2026-10-05');
    expect(parseDate('2026-09-26')).toBe('2026-09-26');
    expect(parseDate('31-Feb-2026')).toBeNull();
    expect(parseDate('IN-JC-00012')).toBeNull();
  });
  it('reads numbers with units, commas and currency', () => {
    expect(parseNum('12 Nos')).toBe(12);
    expect(parseNum('₹ 1,250.50')).toBe(1250.5);
    expect(parseNum('-3')).toBe(-3);
    expect(parseNum('IN-JC-12')).toBeNull();
  });
  it('treats the quiet dash as blank', () => {
    expect(normText('—')).toBeNull();
    expect(normText('  ')).toBeNull();
    expect(normText(' a  b ')).toBe('a b');
  });
});

describe('type detection', () => {
  it('finds dates even when the column is not marked date', () => {
    expect(detectType('code', ['01-Oct-2026', null, '02-Oct-2026'])).toBe('date');
  });
  it('codes stay text; pure numbers become num; badges a tick list', () => {
    expect(detectType('code', ['IN-JC-00001', 'IN-JC-00002'])).toBe('text');
    expect(detectType('code', ['10', '2', '1,000'])).toBe('num');
    expect(detectType('num', ['12 Nos', '3 Nos'])).toBe('num');
    expect(detectType('badge', ['Open'])).toBe('list');
  });
});

describe('date presets (IST, week starts Monday)', () => {
  it('this week / last week / months', () => {
    expect(presetRange('thisWeek', TODAY)).toEqual(['2026-09-28', '2026-10-04']);
    expect(presetRange('lastWeek', TODAY)).toEqual(['2026-09-21', '2026-09-27']);
    expect(presetRange('thisMonth', TODAY)).toEqual(['2026-10-01', '2026-10-31']);
    expect(presetRange('lastMonth', '2026-01-15')).toEqual(['2025-12-01', '2025-12-31']);
    expect(presetRange('yesterday', TODAY)).toEqual(['2026-09-30', '2026-09-30']);
  });
});

describe('matching', () => {
  it('number operators incl. between in either order', () => {
    expect(matches({ kind: 'num', op: 'gt', a: 5 }, '6 Nos', TODAY)).toBe(true);
    expect(matches({ kind: 'num', op: 'between', a: 10, b: 1 }, '5', TODAY)).toBe(true);
    expect(matches({ kind: 'num', op: 'eq', a: 5 }, null, TODAY)).toBe(false);
  });
  it('date before / after / between and reversed ranges', () => {
    const d = '28-Sep-2026';
    expect(matches({ kind: 'date', op: 'before', from: '2026-09-28' }, d, TODAY)).toBe(false);
    expect(matches({ kind: 'date', op: 'after', from: '2026-09-27' }, d, TODAY)).toBe(true);
    expect(
      matches({ kind: 'date', op: 'between', from: '2026-09-30', to: '2026-09-01' }, d, TODAY),
    ).toBe(true);
    expect(matches({ kind: 'date', op: 'thisWeek' }, d, TODAY)).toBe(true);
    expect(matches({ kind: 'date', op: 'today' }, d, TODAY)).toBe(false);
  });
  it('tick list includes blanks by token', () => {
    expect(matches({ kind: 'values', values: [BLANK] }, null, TODAY)).toBe(true);
    expect(matches({ kind: 'values', values: ['Open'] }, 'Closed', TODAY)).toBe(false);
  });
  it('text contains is case-insensitive', () => {
    expect(matches({ kind: 'text', op: 'contains', q: 'flange' }, 'Main FLANGE', TODAY)).toBe(true);
    expect(matches({ kind: 'text', op: 'notContains', q: 'x' }, 'abc', TODAY)).toBe(true);
  });
});

describe('applySortFilter', () => {
  const cols = new Map<string, SfColumn>([
    ['code', { id: 'code', type: 'text', texts: ['IN-JC-10', 'IN-JC-9', 'IN-JC-11', null] }],
    ['qty', { id: 'qty', type: 'num', texts: ['5', '20', null, '1'] }],
  ]);
  it('natural sort, blanks last in both directions, stable', () => {
    expect(
      applySortFilter(4, cols, { sort: { id: 'code', dir: 'asc' }, filters: {} }, TODAY),
    ).toEqual([1, 0, 2, 3]);
    expect(
      applySortFilter(4, cols, { sort: { id: 'code', dir: 'desc' }, filters: {} }, TODAY),
    ).toEqual([2, 0, 1, 3]);
  });
  it('filters then sorts; ignores filters on vanished columns', () => {
    const out = applySortFilter(
      4,
      cols,
      {
        sort: { id: 'qty', dir: 'desc' },
        filters: {
          qty: { kind: 'num', op: 'gte', a: 2 },
          gone: { kind: 'text', op: 'contains', q: 'z' },
        },
      },
      TODAY,
    );
    expect(out).toEqual([1, 0]);
  });
  it('distinct values sorted naturally with blanks last', () => {
    expect(distinctValues(['b', null, 'a', 'b'], 'text')).toEqual(['a', 'b', BLANK]);
  });
});

describe('sanitizeState', () => {
  it('drops malformed stored entries', () => {
    const s = sanitizeState({
      sort: { id: 'x', dir: 'sideways' },
      filters: { a: { kind: 'values', values: ['ok'] }, b: { kind: 'num', a: 'NaN' }, c: 5 },
    });
    expect(s.sort).toBeNull();
    expect(Object.keys(s.filters)).toEqual(['a']);
  });
  it('returns empty for junk', () => {
    expect(sanitizeState('junk')).toEqual({ sort: null, filters: {} });
  });
});

describe('review fixes', () => {
  it('"after" ignores a stale "to" left from a range', () => {
    expect(
      matches(
        { kind: 'date', op: 'after', from: '2026-09-01', to: '2026-09-10' },
        '20-Sep-2026',
        TODAY,
      ),
    ).toBe(true);
  });
  it('unknown ops and bad dates from storage are dropped, never crash', () => {
    const s = sanitizeState({
      filters: {
        a: { kind: 'date', op: 'thisQuarter' },
        b: { kind: 'text', op: 'regex', q: 'x' },
        c: { kind: 'date', op: 'between', from: 'junk', to: '2026-09-01' },
      },
    });
    expect(Object.keys(s.filters)).toEqual(['c']);
    expect(s.filters.c).toEqual({ kind: 'date', op: 'between', from: undefined, to: '2026-09-01' });
  });
});
