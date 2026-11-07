// Day Log History PDF (ADR-278): the builder draws what the server sent, in the
// approved structure and words. The calendar's tests: print-history-calendar.test.ts.

import { describe, expect, it } from 'vitest';
import { historyFileName } from './print-day-log-history';
import {
  blank,
  build,
  count,
  day,
  entry,
  history,
  rangeHtml,
  reply,
} from './print-history-fixture';

describe('Day Log History PDF: a date part', () => {
  it('keeps the full Working On text, with no cut', () => {
    const long = 'Route Card entry for all fourteen items '.repeat(40).trim();
    expect(build(history([day({ entries: [entry({ description: long })] })]))).toContain(long);
  });

  it('escapes everything the user typed, in the name bar and the foot too', () => {
    const html = build(
      history(
        [
          day({
            entries: [
              entry({
                description: '<script>alert(1)</script> & "more"',
                replies: [reply({ body: '<b>reply</b>' })],
              }),
            ],
            replies: 1,
          }),
        ],
        { userName: 'A<b>"x"', deptLabel: 'D<i>' },
      ),
    );
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;more&quot;');
    expect(html).not.toContain('<b>reply</b>');
    expect(html).toContain('Logged by: A&lt;b&gt;&quot;x&quot;');
    expect(html).toContain('<span class="jnb-name">A&lt;b&gt;&quot;x&quot;</span>');
    expect(html).toContain('<span class="jnb-sub">D&lt;i&gt; · Printed ');
    expect(html).toContain('data-page-foot="A&lt;b&gt;&quot;x&quot; · 22-10-2026 · Printed ');
  });

  it('merges edits and replies oldest first, though revisions arrive newest first', () => {
    const rev = (n: number, text: string, savedAt: string) => ({
      entryRevNo: n,
      description: text,
      fromTime: '09:00',
      toTime: '11:00',
      order: null,
      savedAt,
    });
    const html = build(
      history([
        day({
          edits: 2,
          replies: 1,
          entries: [
            entry({
              description: 'text three',
              entryRevNo: 2,
              entryRevisedAt: '2026-10-23T06:00:00Z',
              revisions: [
                rev(2, 'text three', '2026-10-23T06:00:00Z'),
                rev(1, 'text two', '2026-10-22T11:00:00Z'),
                rev(0, 'text one', '2026-10-22T07:47:00Z'),
              ],
              replies: [reply()],
            }),
          ],
        }),
      ]),
    );
    const at = (s: string): number => html.indexOf(s);
    expect(at('Entry Rev 0 · First saved')).toBeGreaterThan(-1);
    expect(at('Entry Rev 0 · First saved')).toBeLessThan(at('>Entry Rev 1<'));
    expect(at('>Entry Rev 1<')).toBeLessThan(at('Reply · Super Admin'));
    expect(at('Reply · Super Admin')).toBeLessThan(at('Entry Rev 2 · Current'));
    expect(html).toContain('[Edited 2 times]');
    expect(html).toContain('<del>one</del>');
    expect(html).toContain('<ins>two</ins>');
  });

  it('says Times / SO not recorded for a version saved before they were kept', () => {
    const html = build(
      history([
        day({
          edits: 1,
          entries: [
            entry({
              entryRevNo: 1,
              revisions: [
                {
                  entryRevNo: 1,
                  description: 'Route Card entry',
                  fromTime: '09:00',
                  toTime: '11:00',
                  order: null,
                  savedAt: '2026-10-22T09:00:00Z',
                },
                {
                  entryRevNo: 0,
                  description: 'Route Card entry',
                  fromTime: null,
                  toTime: null,
                  order: null,
                  savedAt: '2026-10-22T07:47:00Z',
                },
              ],
            }),
          ],
        }),
      ]),
    );
    expect(html.match(/Times \/ SO not recorded/g)).toHaveLength(2);
    expect(html).toContain('Working On not changed');
  });

  it('prints old rows italic: break as stored, leave as Others', () => {
    const html = build(
      history([
        day({
          entries: [
            entry({ kind: 'break', description: 'Break' }),
            entry({
              id: '00000000-0000-4000-8000-000000000003',
              srNo: 2,
              kind: 'leave',
              description: 'Half day',
            }),
          ],
        }),
      ]),
    );
    expect(html.match(/class="nw"/g)).toHaveLength(2);
    expect(html).toContain('Others · Half day');
    expect(html).not.toContain('Others · Break');
  });

  it('shows an open entry as Open', () => {
    expect(build(history([day({ entries: [entry({ toTime: null })] })]))).toContain('>Open<');
  });

  it('shows a reply in the timeline: Seen by, Not seen yet, and on a blank date', () => {
    const html = rangeHtml(
      [
        day({
          ...blank,
          date: '2026-10-21',
          state: 'not_entered',
          replies: 1,
          dayReplies: [reply()],
        }),
        day({
          replies: 2,
          entries: [
            entry({
              replies: [
                reply({ seenAt: '2026-10-23T06:10:00Z', editedAt: '2026-10-23T06:00:00Z' }),
                reply(),
              ],
            }),
          ],
        }),
      ],
      '2026-10-21',
      '2026-10-22',
    );
    expect(html).toContain('Seen by Mayur · 23-10-2026 11:40 AM<br>Edited 23-10-2026 11:30 AM');
    expect(html.match(/>Not seen yet</g)).toHaveLength(2);
    expect(html).toContain('data-page-anchor="date-2026-10-21"');
  });

  it('shows a waiting edit last in the timeline, diffed against the current text', () => {
    const html = build(
      history([
        day({
          entries: [
            entry({
              pending: {
                fromTime: '09:30',
                toTime: '11:00',
                description: 'Route Card check',
                order: null,
                requestedAt: '2026-10-22T09:00:00Z',
              },
            }),
          ],
        }),
      ]),
    );
    expect(html).toContain('>Waiting approval<');
    expect(html).toContain('Start Time 09:00 AM → 09:30 AM');
    expect(html).toContain('<del>entry</del>');
    expect(html).toContain('<ins>check</ins>');
  });

  it('keeps the Log Date of an entry saved on a later date, and the count', () => {
    const html = build(
      history([
        day({
          savedLater: 1,
          entries: [entry({ loggedAt: '2026-10-23T07:47:00Z', savedLaterOn: '2026-10-23' })],
        }),
      ]),
    );
    expect(html).toContain('>23-10-2026<');
    expect(html).toMatch(/Saved Later<\/span><span class="jv">1</);
  });

  it('shows the legend only on a date with entries', () => {
    const legend = 'Edits, oldest first';
    expect(build(history([day()]))).toContain(legend);
    const empty = build(
      history([day({ ...blank, state: 'not_entered', dayReplies: [reply()], replies: 1 })]),
    );
    expect(empty).not.toContain(legend);
  });

  it('leaves First Start and Last Stop blank with no entries', () => {
    const html = build(history([day({ ...blank, state: 'not_entered' })]));
    expect(html).toContain('First Start</span><span class="jv"></span>');
    expect(html).toContain('Last Stop</span><span class="jv"></span>');
  });

  it('takes the date figures from the server', () => {
    const html = build(
      history([day({ editedEntries: 7, edits: 8, replies: 9, savedLater: 6, workMin: 333 })]),
    );
    expect(html).toContain('Edited Entries</span><span class="jv">7<');
    expect(html).toContain('Edits</span><span class="jv">8<');
    expect(html).toContain('Replies</span><span class="jv">9<');
    expect(html).toContain('Saved Later</span><span class="jv">6<');
    expect(html).toContain('Working Hours</span><span class="jv k">5h 33m<');
  });
});

describe('Day Log History PDF: one date', () => {
  const html = build(history([day()]));

  it('has the name bar and the DATE column, and no first part', () => {
    expect(html).toContain('<span class="jnb-name">Mayur</span>');
    expect(html).toContain('Planning · Printed 06-11-2026 04:12 PM');
    expect(html).toContain('<div class="jt">Date</div>');
    expect(html).toContain('Date</span><span class="jv k">22-10-2026<');
    expect(html).toContain('Day</span><span class="jv">Thursday<');
    expect(html).toContain('Status</span><span class="jv">Filled<');
    expect(html).not.toContain('Calendar');
    expect(html).not.toContain('Dates in this PDF');
    expect(html).not.toContain('<div class="jt">Period</div>');
  });

  it('prints Printed only when the person has no department', () => {
    const noDept = build(history([day()], { deptLabel: null }));
    expect(noDept).toContain('<span class="jnb-sub">Printed 06-11-2026 04:12 PM</span>');
  });

  it('points the Page field at the date itself', () => {
    expect(html).toContain('Page</span><span class="jv"><span data-page-ref="date-2026-10-22">');
  });

  it('is built for the paginator: one table, a column grid, the foot and the sign row', () => {
    expect(html.match(/<table/g)).toHaveLength(1);
    expect(html).toContain('<article class="sheet" data-page-foot="Mayur · 22-10-2026 · Printed');
    expect(html).toContain('<colgroup>');
    expect(html).not.toContain('table class="dl"');
    expect(html).toContain('data-head-for="day-2026-10-22"');
    expect(html).toContain('Seen by (Department Admin):');
    expect(html).toContain('<b>PAN:</b>');
    const oneDateFile = historyFileName('Mayur', '2026-10-22', '2026-10-22');
    expect(oneDateFile).toBe('Day Log History Mayur 2026-10-22');
  });
});

describe('Day Log History PDF: a range, first part', () => {
  const days = [day({ date: '2026-10-21' }), day()];

  it('has the header, calendar, then the date list, then the date pages', () => {
    const html = rangeHtml(days, '2026-10-21', '2026-10-22');
    const order = [
      '<div class="jt">Period</div>',
      '>Calendar ',
      'class="calm"',
      'Dates in this PDF',
      '>First Start<',
      '>Total<',
      'data-page-anchor="date-2026-10-21"',
    ].map((s) => html.indexOf(s));
    expect(order).not.toContain(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).not.toMatch(/\d · (Summary|Points|Date by date|Day detail)/);
    expect(html).not.toContain('Points to check');
    expect(html).toContain('data-page-foot="Mayur · 21-10-2026 to 22-10-2026 · Printed');
    expect(historyFileName('Mayur', '2026-10-21', '2026-10-22')).toBe(
      'Day Log History Mayur 2026-10-21 to 2026-10-22',
    );
  });

  it("shows the server's total days and average, not a worked-out value", () => {
    const totals = {
      ...history([]).totals,
      filledDays: 13,
      notEntered: 4,
      workMin: 100,
      avgDailyWorkMin: 417,
    };
    const html = build(history(days, { from: '2026-10-21', to: '2026-10-22', totals }));
    expect(html).toContain('Total Entry Days</span><span class="jv k">13<');
    expect(html).toContain('Not Entered</span><span class="jv k">4<');
    expect(html).toContain('Total Working Hours</span><span class="jv k">1h 40m<');
    expect(html).toContain('Avg Daily Working Hours</span><span class="jv k">6h 57m<');
  });

  it('bolds Not Entered only above 0, and shows Leave, Break, Others only above 0', () => {
    const none = rangeHtml(days, '2026-10-21', '2026-10-22');
    expect(none).toContain('Not Entered</span><span class="jv">0<');
    for (const word of ['Leave', 'Break', 'Others']) {
      expect(none).not.toContain(`>${word}<`);
    }
    const totals = { ...history([]).totals, leaveDays: 2, breakMin: 45, leaveMin: 60 };
    const some = build(history(days, { from: '2026-10-21', to: '2026-10-22', totals }));
    expect(some).toContain('Leave</span><span class="jv">2<');
    expect(some).toContain('Break</span><span class="jv">0h 45m<');
    expect(some).toContain('Others</span><span class="jv">1h 00m<');
  });

  it('carries the header onto a later page of this part, first before list', () => {
    const html = rangeHtml(days, '2026-10-21', '2026-10-22');
    expect(html).toContain('data-head-for="first"');
    expect(html).toContain('data-carry-head="first list"');
    expect(html).toMatch(/<tr class="calr" data-carry-head="first">/);
    expect(html).toMatch(/<tr class="sect sect-cal" data-keep-next data-carry-head="first">/);
    expect(html).toMatch(/<tr class="sect" data-keep-next data-carry-head="first">/);
  });

  it('never puts data-contd on a header row', () => {
    expect(rangeHtml(days, '2026-10-21', '2026-10-22')).not.toContain('data-contd');
    expect(build(history([day()]))).not.toContain('data-contd');
  });

  it('words every date status in the date list', () => {
    const html = rangeHtml(
      [
        day({ ...blank, date: '2026-09-01', state: 'not_counted' }),
        day({ ...blank, date: '2026-09-02', state: 'not_entered' }),
        day({ ...blank, date: '2026-09-03', state: 'holiday', holidayName: 'Onam' }),
        day({ ...blank, date: '2026-09-06', state: 'sunday' }),
        day({ date: '2026-09-07', state: 'today' }),
        day({ date: '2026-09-08', state: 'leave' }),
        day({ date: '2026-09-09' }),
      ],
      '2026-09-01',
      '2026-09-09',
    );
    for (const w of ['Not counted', 'Not entered', 'Holiday · Onam', 'Sunday', 'Today', 'Leave']) {
      expect(html).toContain(`>${w}<`);
    }
    expect(html).toContain('>Filled<');
  });
});

describe('Day Log History PDF: a date page per date', () => {
  const html = rangeHtml(
    [
      day({ ...blank, date: '2026-09-01', state: 'not_counted' }),
      day({ ...blank, date: '2026-09-02', state: 'not_entered' }),
      day({ ...blank, date: '2026-09-06', state: 'sunday' }),
      day({ ...blank, date: '2026-09-13', state: 'holiday' }),
      day({ date: '2026-09-07' }),
      day({ ...blank, date: '2026-09-20', state: 'sunday', dayReplies: [reply()], replies: 1 }),
    ],
    '2026-09-01',
    '2026-09-20',
  );

  it('starts a new page for every date that has anything, and only for those', () => {
    for (const date of ['2026-09-02', '2026-09-07', '2026-09-20']) {
      expect(html).toMatch(
        new RegExp(`<tr data-keep-next data-page-break data-head-for="day-${date}"`),
      );
      expect(html).toContain(`data-page-anchor="date-${date}"`);
    }
    for (const date of ['2026-09-01', '2026-09-06', '2026-09-13']) {
      expect(html).not.toContain(`data-page-anchor="date-${date}"`);
    }
    expect(count(html, /data-page-break/g)).toBe(3);
  });

  it('has one sign row per date part, carrying its date', () => {
    expect(count(html, /class="sign"/g)).toBe(3);
    expect(html).toContain('<tr class="sign" data-carry-head="day-2026-09-07">');
  });
});
