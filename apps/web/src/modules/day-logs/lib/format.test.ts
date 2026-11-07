import { describe, expect, it } from 'vitest';
import { historyQuickRanges } from './format';

const range = (today: string, label: string) => {
  const r = historyQuickRanges(today).find((x) => x.label === label);
  return [r?.from, r?.to];
};

describe('History quick ranges', () => {
  it('Today is one date', () => {
    expect(range('2026-11-07', 'Today')).toEqual(['2026-11-07', '2026-11-07']);
  });

  it('Last 15 Days counts 15 dates, today included, across a month end', () => {
    expect(range('2026-11-07', 'Last 15 Days')).toEqual(['2026-10-24', '2026-11-07']);
  });

  it('This Month on the 1st is that one date', () => {
    expect(range('2026-11-01', 'This Month')).toEqual(['2026-11-01', '2026-11-01']);
  });

  it('Last Month is the whole previous month, December when in January', () => {
    expect(range('2027-01-15', 'Last Month')).toEqual(['2026-12-01', '2026-12-31']);
  });

  it('Last Month knows a leap February', () => {
    expect(range('2028-03-31', 'Last Month')).toEqual(['2028-02-01', '2028-02-29']);
  });
});
