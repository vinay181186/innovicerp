import { describe, expect, it } from 'vitest';
import { fmtDate, fmtDateAndTime, fmtDateTime } from './date';

describe('fmtDate', () => {
  it('reads a plain YYYY-MM-DD as a calendar date', () => {
    expect(fmtDate('2026-09-26')).toBe('26-Sep-2026');
    expect(fmtDate('2026-01-01')).toBe('01-Jan-2026');
  });
  it('shows a timestamp as its IST date', () => {
    expect(fmtDate('2026-09-25T20:00:00Z')).toBe('26-Sep-2026');
  });
  it('blank → dash, junk → as-is', () => {
    expect(fmtDate(null)).toBe('—');
    expect(fmtDate('', '')).toBe('');
    expect(fmtDate('n/a')).toBe('n/a');
  });
});

describe('fmtDateTime', () => {
  it('formats in IST, 24-hour', () => {
    expect(fmtDateTime('2026-09-26T08:35:00Z')).toBe('26-Sep-2026 14:05');
  });
  it('plain date has no time', () => {
    expect(fmtDateTime('2026-09-26')).toBe('26-Sep-2026');
  });
});

describe('fmtDateAndTime', () => {
  it('joins a date and a wall-clock time', () => {
    expect(fmtDateAndTime('2026-09-26', '09:05:33')).toBe('26-Sep-2026 09:05');
    expect(fmtDateAndTime('2026-09-26', null)).toBe('26-Sep-2026');
  });
});
