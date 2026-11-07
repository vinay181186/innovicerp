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

  it('Last 15 days counts 15 dates, today included, across a month end', () => {
    expect(range('2026-11-07', 'Last 15 days')).toEqual(['2026-10-24', '2026-11-07']);
  });

  it('This month on the 1st is that one date', () => {
    expect(range('2026-11-01', 'This month')).toEqual(['2026-11-01', '2026-11-01']);
  });

  it('Last month is the whole previous month, December when in January', () => {
    expect(range('2027-01-15', 'Last month')).toEqual(['2026-12-01', '2026-12-31']);
  });

  it('Last month knows a leap February', () => {
    expect(range('2028-03-31', 'Last month')).toEqual(['2028-02-01', '2028-02-29']);
  });
});
