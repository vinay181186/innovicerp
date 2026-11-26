import { describe, expect, it } from 'vitest';
import { ValidationError } from './errors';
import { assertNotBefore, latestDated } from './doc-date-order';

describe('assertNotBefore', () => {
  it('refuses a child dated before its parent, with the given message', () => {
    expect(() => assertNotBefore('2026-09-09', '2026-10-24', 'too early')).toThrow(ValidationError);
    expect(() => assertNotBefore('2026-09-09', '2026-10-24', 'too early')).toThrow('too early');
  });
  it('allows the same day and later days', () => {
    expect(() => assertNotBefore('2026-10-24', '2026-10-24', 'x')).not.toThrow();
    expect(() => assertNotBefore('2026-10-25', '2026-10-24', 'x')).not.toThrow();
  });
  it('allows any date when there is no parent date', () => {
    expect(() => assertNotBefore('2026-01-01', null, 'x')).not.toThrow();
    expect(() => assertNotBefore('2026-01-01', undefined, 'x')).not.toThrow();
  });
  it('compares by calendar day across month and year ends', () => {
    expect(() => assertNotBefore('2026-12-31', '2027-01-01', 'x')).toThrow();
    expect(() => assertNotBefore('2027-01-01', '2026-12-31', 'x')).not.toThrow();
  });
});

describe('latestDated', () => {
  it('picks the latest dated row and skips blanks', () => {
    const rows = [
      { code: 'A', date: '2026-10-01' },
      { code: 'B', date: null },
      { code: 'C', date: '2026-10-24' },
    ];
    expect(latestDated(rows)?.code).toBe('C');
  });
  it('returns null when nothing is dated', () => {
    expect(latestDated([])).toBeNull();
    expect(latestDated([{ date: null }])).toBeNull();
  });
});
