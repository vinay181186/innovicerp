// Day Log History PDF (ADR-278): the builder draws what the server sent, in the
// approved structure and words.

import type { DayLogHistory, DayLogHistoryDay, DayLogHistoryEntry } from '@innovic/shared';
import { describe, expect, it } from 'vitest';
import { dayLogHistoryHtml } from './print-day-log-history';

const NOW = new Date('2026-11-06T10:42:00Z');
const REPLY_ID = '00000000-0000-4000-8000-000000000009';

function entry(over: Partial<DayLogHistoryEntry> = {}): DayLogHistoryEntry {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    srNo: 1,
    kind: 'work',
    loggedAt: '2026-10-22T07:47:00Z',
    fromTime: '09:00',
    toTime: '11:00',
    minutes: 120,
    order: null,
    description: 'Route Card entry',
    entryRevNo: 0,
    entryRevisedAt: null,
    revisions: [
      {
        entryRevNo: 0,
        description: 'Route Card entry',
        fromTime: '09:00',
        toTime: '11:00',
        order: null,
        savedAt: '2026-10-22T07:47:00Z',
      },
    ],
    replies: [],
    pending: null,
    savedLaterOn: null,
    ...over,
  };
}

function day(over: Partial<DayLogHistoryDay> = {}): DayLogHistoryDay {
  return {
    date: '2026-10-22',
    state: 'filled',
    holidayName: null,
    firstStart: '09:00',
    lastStop: '11:00',
    workMin: 120,
    entryCount: 1,
    edits: 0,
    replies: 0,
    savedLater: 0,
    entries: [entry()],
    dayReplies: [],
    ...over,
  };
}

function history(days: DayLogHistoryDay[], over: Partial<DayLogHistory> = {}): DayLogHistory {
  return {
    userId: '00000000-0000-4000-8000-000000000002',
    userName: 'Mayur',
    deptLabel: 'Planning',
    month: null,
    date: '2026-10-22',
    today: '2026-11-06',
    days,
    totals: {
      workingDays: 1,
      filledDays: 1,
      notEntered: 0,
      offDays: 0,
      leaveDays: 0,
      entries: 1,
      workMin: 120,
      breakMin: 0,
      leaveMin: 0,
      editedEntries: 0,
      edits: 0,
      replies: 0,
      savedLater: 0,
    },
    hasContent: true,
    ...over,
  };
}

const reply = (over: { seenAt?: string | null; editedAt?: string | null; body?: string } = {}) => ({
  id: REPLY_ID,
  body: over.body ?? 'Why was this changed?',
  authorName: 'Super Admin',
  sentAt: '2026-10-23T05:35:00Z',
  editedAt: over.editedAt ?? null,
  seenAt: over.seenAt ?? null,
  updatedAt: '2026-10-23T05:35:00Z',
  canEdit: true,
});

const build = (h: DayLogHistory): string => dayLogHistoryHtml(h, null, NOW);

describe('Day Log History PDF', () => {
  it('keeps the full Working On text, with no cut', () => {
    const long = 'Route Card entry for all fourteen items '.repeat(40).trim();
    expect(build(history([day({ entries: [entry({ description: long })] })]))).toContain(long);
  });

  it('escapes everything the user typed', () => {
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
        { userName: 'A<b>"x"' },
      ),
    );
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;more&quot;');
    expect(html).not.toContain('<b>reply</b>');
    expect(html).toContain('Logged by: A&lt;b&gt;&quot;x&quot;');
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
    expect(html).toContain('Edited 2 times · last on 23-10-2026 11:30 AM');
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

  it('shows Break and Others in the summary only when above 0', () => {
    const none = build(history([day()]));
    expect(none).not.toContain('>Break<');
    expect(none).not.toContain('>Others<');
    const totals = { ...history([]).totals, breakMin: 45, leaveMin: 60 };
    const some = build(history([day()], { totals }));
    expect(some).toContain('>Break<');
    expect(some).toContain('0h 45m');
    expect(some).toContain('>Others<');
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

  it('words every date status, Not counted included', () => {
    const blank = { firstStart: null, lastStop: null, workMin: 0, entryCount: 0, entries: [] };
    const html = build(
      history(
        [
          day({ ...blank, date: '2026-09-01', state: 'not_counted' }),
          day({ ...blank, date: '2026-09-02', state: 'not_entered' }),
          day({ ...blank, date: '2026-09-03', state: 'holiday', holidayName: 'Onam' }),
          day({ ...blank, date: '2026-09-06', state: 'sunday' }),
          day({ date: '2026-09-07', state: 'today' }),
          day({ date: '2026-09-08', state: 'leave' }),
          day({ date: '2026-09-09' }),
        ],
        { month: '2026-09', date: null },
      ),
    );
    for (const w of ['Not counted', 'Not entered', 'Holiday · Onam', 'Sunday', 'Today', 'Leave']) {
      expect(html).toContain(`>${w}<`);
    }
    expect(html).toContain('September 2026');
    expect(html).toContain('>Filled<');
  });

  it('leaves Sunday, holiday and Not counted out of Day detail', () => {
    const blank = { firstStart: null, lastStop: null, workMin: 0, entryCount: 0, entries: [] };
    const html = build(
      history(
        [
          day({ ...blank, date: '2026-09-01', state: 'not_counted' }),
          day({ ...blank, date: '2026-09-06', state: 'sunday' }),
          day({ date: '2026-09-07' }),
        ],
        { month: '2026-09', date: null },
      ),
    );
    expect(html).toContain('data-page-anchor="date-2026-09-07"');
    expect(html).not.toContain('data-page-anchor="date-2026-09-01"');
    expect(html).not.toContain('data-page-anchor="date-2026-09-06"');
  });

  it('points to replies: Seen by, Not seen yet, and a blank date with its reply', () => {
    const blank = { firstStart: null, lastStop: null, workMin: 0, entryCount: 0, entries: [] };
    const html = build(
      history(
        [
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
          day({
            ...blank,
            date: '2026-10-21',
            state: 'not_entered',
            replies: 1,
            dayReplies: [reply()],
          }),
        ],
        { month: '2026-10', date: null },
      ),
    );
    expect(html).toContain('>Reply · Seen by Mayur · 23-10-2026 11:40 AM<');
    expect(html).toContain('>Reply · Not seen yet<');
    expect(html).toContain('Not entered · Reply sent · Not seen');
    expect(html).toContain('Seen by Mayur · 23-10-2026 11:40 AM<br>Edited 23-10-2026 11:30 AM');
  });

  it('points to a waiting edit, last in the timeline, diffed against the current text', () => {
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
    expect(html).toContain('Edit waiting approval');
    expect(html).toContain('>Waiting approval<');
    expect(html).toContain('Start Time 09:00 AM → 09:30 AM');
    expect(html).toContain('<del>entry</del>');
    expect(html).toContain('<ins>check</ins>');
  });

  it('points to entries saved on a later date, as one row', () => {
    const html = build(
      history([day({ savedLater: 1, entries: [entry({ savedLaterOn: '2026-10-23' })] })]),
    );
    expect(html).toContain('Saved on a later date: 23-10-2026');
    expect(html).toContain('>All<');
  });

  it('says Nothing to check when there is nothing', () => {
    expect(build(history([day()]))).toContain('Nothing to check.');
  });

  it('has no Date by date for one date, and Day detail is part 3 on the same page', () => {
    const html = build(history([day()]));
    expect(html).not.toContain('Date by date');
    expect(html).toContain('3 · Day detail');
    expect(html).not.toContain('data-page-break');
  });

  it('has Date by date for a month, and Day detail is part 4 on a new page', () => {
    const html = build(
      history([day({ date: '2026-10-21' }), day()], { month: '2026-10', date: null }),
    );
    for (const s of ['1 · Summary', '2 · Points to check', '3 · Date by date', '4 · Day detail']) {
      expect(html).toContain(s);
    }
    expect(html).toMatch(/<tr class="sect" data-keep-next data-page-break>[^]*?4 · Day detail/);
    expect(html).toContain('>Total<');
  });

  it('is built for the paginator: one table, a column grid, the foot and the sign row', () => {
    const html = build(history([day()]));
    expect(html.match(/<table/g)).toHaveLength(1);
    expect(html).toContain('<article class="sheet" data-page-foot="Mayur · 22-10-2026 · Printed');
    expect(html).toContain('<colgroup>');
    expect(html).not.toContain('table class="dl"');
    expect(html).toContain('data-head-for="day-2026-10-22"');
    expect(html).toContain('Seen by (Department Admin):');
    expect(html).toContain('<b>PAN:</b>');
  });
});
