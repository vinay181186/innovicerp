// Day Log History PDF (ADR-278): the calendar draws the server's days, month by month.

import { describe, expect, it } from 'vitest';
import { CALENDAR_STYLE } from './print-history-calendar';
import { blank, count, day, rangeHtml } from './print-history-fixture';

/** The HTML of one month's grid. */
function monthOf(html: string, name: string): string {
  const at = html.indexOf(`<div class="mon">${name}</div>`);
  expect(at, name).toBeGreaterThan(-1);
  const end = html.indexOf('<div class="calm">', at);
  const rowEnd = html.indexOf('</td>', at);
  return html.slice(at, end > -1 && end < rowEnd ? end : rowEnd);
}

/** The HTML of one date's cell in a month. */
function cellOf(month: string, n: number): string {
  const num = `<span class="cd-n">${n}</span>`;
  const at = month.indexOf(num);
  expect(at, String(n)).toBeGreaterThan(-1);
  const start = month.lastIndexOf('<div class="cd', at);
  return month.slice(start, month.indexOf('</div>', at));
}

describe('Day Log History PDF: the calendar', () => {
  it('one month: one calendar, full width', () => {
    const html = rangeHtml([day(), day({ date: '2026-10-23' })], '2026-10-22', '2026-10-23');
    expect(count(html, /class="calm"/g)).toBe(1);
    expect(html).toContain('<div class="cals one">');
    expect(html).toContain('<div class="mon">October 2026</div>');
  });

  it('two months: two calendars side by side in one row', () => {
    const html = rangeHtml(
      [day({ date: '2026-10-31' }), day({ date: '2026-11-02' })],
      '2026-10-31',
      '2026-11-02',
    );
    expect(count(html, /class="calm"/g)).toBe(2);
    expect(count(html, /class="calr"/g)).toBe(1);
    expect(html).toContain('<div class="cals">');
  });

  it('three months: a lone last month stays half width, in a row of its own', () => {
    const html = rangeHtml(
      [day({ date: '2026-09-30' }), day({ date: '2026-11-01' })],
      '2026-09-30',
      '2026-11-01',
    );
    expect(count(html, /class="calm"/g)).toBe(3);
    expect(count(html, /class="calr"/g)).toBe(2);
    expect(html).not.toContain('cals one');
  });

  it('crosses a year into the right months', () => {
    const html = rangeHtml(
      [day({ date: '2026-12-31' }), day({ date: '2027-01-01' })],
      '2026-12-31',
      '2027-01-01',
    );
    expect(html).toContain('<div class="mon">December 2026</div>');
    expect(html).toContain('<div class="mon">January 2027</div>');
    expect(count(html, /class="calm"/g)).toBe(2);
  });

  it('a month needing 6 week rows is complete', () => {
    // 1 Aug 2026 is a Saturday: 6 blanks, 31 dates, 5 more = 42 cells.
    const html = rangeHtml([day({ date: '2026-08-01' })], '2026-08-01', '2026-08-02');
    const month = monthOf(html, 'August 2026');
    expect(count(month, /class="cd[ "]/g)).toBe(42);
    expect(count(month, /class="cd"><\/div>/g)).toBe(11);
    expect(month).toContain('<span class="cd-n">31</span>');
  });

  it('a month starting on Sunday has no leading blank', () => {
    // 1 Nov 2026 is a Sunday.
    const html = rangeHtml([day({ date: '2026-11-01' })], '2026-11-01', '2026-11-02');
    const month = monthOf(html, 'November 2026');
    expect(month).toMatch(/<div class="dow">Sat<\/div><div class="cd[^"]*"><span class="cd-n">1</);
  });

  it('draws each state in its words, grey for Not entered', () => {
    const html = rangeHtml(
      [
        day({ date: '2026-09-01', workMin: 95 }),
        day({ ...blank, date: '2026-09-02', state: 'not_entered' }),
        day({ ...blank, date: '2026-09-03', state: 'sunday' }),
        day({ ...blank, date: '2026-09-04', state: 'holiday', holidayName: 'Onam' }),
        day({ ...blank, date: '2026-09-05', state: 'leave' }),
        day({ ...blank, date: '2026-09-07', state: 'not_counted' }),
        day({ ...blank, date: '2026-09-08', state: 'today' }),
        day({ date: '2026-09-09', state: 'today', workMin: 61 }),
      ],
      '2026-09-01',
      '2026-09-09',
    );
    const month = monthOf(html, 'September 2026');
    expect(cellOf(month, 1)).toContain('<span class="cd-h">1h 35m</span>');
    expect(cellOf(month, 2)).toContain('<div class="cd ne">');
    expect(cellOf(month, 2)).toContain('>N/E<');
    expect(CALENDAR_STYLE).toContain('.cd.ne{background:#D9D9D9');
    expect(cellOf(month, 3)).toContain('<div class="cd off">');
    expect(cellOf(month, 3)).toContain('>Sunday<');
    expect(cellOf(month, 4)).toContain('<div class="cd off">');
    expect(cellOf(month, 4)).toContain('>Holiday<');
    expect(cellOf(month, 4)).not.toContain('Onam');
    expect(cellOf(month, 5)).toContain('>Leave<');
    expect(cellOf(month, 7)).toContain('>Not counted<');
    expect(cellOf(month, 8)).toContain('>Today<');
    expect(cellOf(month, 9)).toContain('<span class="cd-h">1h 01m</span>');
  });

  it('a date outside From Date to To Date is a grey number and nothing else', () => {
    const html = rangeHtml(
      [day({ date: '2026-10-21' }), day({ date: '2026-10-22' })],
      '2026-10-21',
      '2026-10-22',
    );
    const month = monthOf(html, 'October 2026');
    expect(cellOf(month, 20)).toBe('<div class="cd out"><span class="cd-n">20</span>');
    expect(cellOf(month, 23)).toBe('<div class="cd out"><span class="cd-n">23</span>');
    expect(cellOf(month, 21)).toContain('2h 00m');
    expect(CALENDAR_STYLE).toContain('.cd.out{color:#8A8A8A}');
  });
});
