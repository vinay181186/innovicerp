import { describe, expect, it } from 'vitest';
import { fmtClock, fmtDate, fmtDateAndTime, fmtDateTime, fmtTime, fmtTime12 } from './date';

describe('fmtDate', () => {
  it('reads a plain YYYY-MM-DD as a calendar date (DD-MM-YYYY)', () => {
    expect(fmtDate('2026-09-26')).toBe('26-09-2026');
    expect(fmtDate('2026-01-01')).toBe('01-01-2026');
    expect(fmtDate('2026-11-03')).toBe('03-11-2026');
  });
  it('shows a timestamp as its IST date', () => {
    expect(fmtDate('2026-09-25T20:00:00Z')).toBe('26-09-2026');
    // 18:29 UTC is still the same IST day (23:59); 18:30 UTC is the next.
    expect(fmtDate('2026-11-02T18:29:00Z')).toBe('02-11-2026');
    expect(fmtDate('2026-11-02T18:30:00Z')).toBe('03-11-2026');
  });
  it('blank → dash, junk → as-is', () => {
    expect(fmtDate(null)).toBe('—');
    expect(fmtDate('', '')).toBe('');
    expect(fmtDate('n/a')).toBe('n/a');
    expect(fmtDate('2026-13-01')).toBe('2026-13-01');
  });
});

describe('fmtDateTime', () => {
  it('formats in IST, 12-hour', () => {
    expect(fmtDateTime('2026-09-26T08:35:00Z')).toBe('26-09-2026 02:05 PM');
    expect(fmtDateTime('2026-11-03T09:05:00Z')).toBe('03-11-2026 02:35 PM');
  });
  it('midnight and noon on the 12-hour dial', () => {
    expect(fmtDateTime('2026-11-02T18:45:00Z')).toBe('03-11-2026 12:15 AM');
    expect(fmtDateTime('2026-11-03T06:30:00Z')).toBe('03-11-2026 12:00 PM');
  });
  it('plain date has no time', () => {
    expect(fmtDateTime('2026-09-26')).toBe('26-09-2026');
  });
});

describe('fmtTime / fmtTime12', () => {
  it('prints the IST clock on the 12-hour dial', () => {
    expect(fmtTime('2026-11-03T09:05:00Z')).toBe('02:35 PM');
    expect(fmtTime('2026-11-03T03:30:00Z')).toBe('09:00 AM');
    expect(fmtTime(Date.parse('2026-11-03T09:05:00Z'))).toBe('02:35 PM');
    expect(fmtTime12('2026-11-03T09:05:00Z')).toBe('02:35 PM');
  });
  it('blank / junk → empty; fmtTime12 never invents a time from a bare date', () => {
    expect(fmtTime(null)).toBe('');
    expect(fmtTime('junk', '—')).toBe('—');
    expect(fmtTime12('2026-11-03')).toBe('');
  });
});

describe('fmtClock', () => {
  it('a stored wall-clock time on the 12-hour dial, no zone shift', () => {
    expect(fmtClock('14:35:00')).toBe('02:35 PM');
    expect(fmtClock('00:15')).toBe('12:15 AM');
    expect(fmtClock('12:00')).toBe('12:00 PM');
    expect(fmtClock(null, '—')).toBe('—');
    expect(fmtClock('junk')).toBe('');
  });
});

describe('fmtDateAndTime', () => {
  it('joins a date and a wall-clock time', () => {
    expect(fmtDateAndTime('2026-09-26', '09:05:33')).toBe('26-09-2026 09:05 AM');
    expect(fmtDateAndTime('2026-09-26', '17:40')).toBe('26-09-2026 05:40 PM');
    expect(fmtDateAndTime('2026-09-26', null)).toBe('26-09-2026');
  });
});
