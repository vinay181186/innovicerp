// My Day Log print (ADR-288): the same data as before, in the Job Card layout.

import type { DayLogDetail } from '@innovic/shared';
import { describe, expect, it } from 'vitest';
import { myDayLogHtml } from './print-my-day-log';

type Entry = DayLogDetail['entries'][number];

const NOW = new Date('2026-11-07T10:42:00Z');

function entry(over: Partial<Entry> = {}): Entry {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    kind: 'work',
    fromTime: '09:30',
    toTime: '11:00',
    minutes: 90,
    description: 'Route Card check',
    order: { type: 'so', id: '00000000-0000-4000-8000-000000000003', code: 'IN-SO-00412' },
    remarks: null,
    late: false,
    updatedAt: '2026-11-06T05:32:00Z',
    loggedAt: '2026-11-06T05:32:00Z',
    replies: [],
    pending: null,
    rejectReason: null,
    ...over,
  };
}

function detail(over: Partial<DayLogDetail> = {}): DayLogDetail {
  return {
    id: '00000000-0000-4000-8000-000000000004',
    userId: '00000000-0000-4000-8000-000000000002',
    userName: 'Mayur',
    deptLabel: 'Planning',
    date: '2026-11-06',
    today: '2026-11-07',
    nowTime: '16:12',
    status: 'draft',
    workingDay: true,
    holidayName: null,
    entries: [entry()],
    summary: {
      workMin: 90,
      breakMin: 0,
      leaveMin: 0,
      firstStart: '09:30',
      lastStop: '11:00',
      unloggedMin: 0,
      open: false,
      entryCount: 1,
      nextStart: null,
      lateCount: 0,
      lateInMin: 0,
    },
    submittedAt: null,
    submittedByName: null,
    leaveReason: null,
    reopenedAt: null,
    reopenedByName: null,
    reopenReason: null,
    strayOpen: null,
    isOwner: true,
    canWrite: true,
    canManage: false,
    lastEntryId: null,
    dayReplies: [],
    ...over,
  } as DayLogDetail;
}

const build = (d: DayLogDetail): string => myDayLogHtml(d, null, NOW);

describe('My Day Log print', () => {
  it('puts the name bar and the Day Log and Work columns in the repeating head', () => {
    const html = build(detail());
    const head = html.slice(html.indexOf('<thead>'), html.indexOf('</thead>'));
    expect(head).toContain('<span class="jnb-name">Mayur</span>');
    expect(head).toContain('Planning · Printed 07-11-2026 04:12 PM');
    expect(head).toContain('Date</span><span class="jv k">06-11-2026<');
    expect(head).toContain('Entries</span><span class="jv">1<');
    expect(head).toContain('First Start</span><span class="jv">09:30 AM<');
    expect(head).toContain('Last Stop</span><span class="jv">11:00 AM<');
    expect(head).toContain('Working Hours</span><span class="jv k">1h 30m<');
  });

  it('keeps the eight columns in order and carries their heading onto a new page', () => {
    const html = build(detail());
    const labels = [
      'Sr No',
      'Log Date',
      'Log Time',
      'Start Time',
      'Stop Time',
      'Working Hours',
      'SO / JWSO',
      'Working On',
    ];
    const headRow = html.match(/<tr class="hd"[^>]*>.*?<\/tr>/s)?.[0] ?? '';
    expect(headRow).toContain('data-head-for="entries"');
    expect(labels.map((l) => headRow.indexOf(`>${l}<`))).toEqual(
      labels.map((l) => headRow.indexOf(`>${l}<`)).sort((a, b) => a - b),
    );
    expect(headRow).not.toContain('>-1<');
    expect(html).toContain('data-carry-head="entries"');
    expect(html).toContain('<td colspan="7" class="b">IN-SO-00412<');
    expect(html).toContain('<td colspan="18" class="wo">Route Card check<');
  });

  it('prints the total once, in the head, with no total row below', () => {
    const html = build(detail());
    const body = html.slice(html.indexOf('<tbody>'), html.indexOf('</tbody>'));
    expect(body).not.toContain('First start');
    expect(body.match(/1h 30m/g)).toHaveLength(1);
  });

  it('keeps the last entry with the sign block, and prints both signers', () => {
    const html = build(
      detail({ entries: [entry(), entry({ fromTime: '11:00', toTime: '12:00' })] }),
    );
    expect(html.match(/<tr[^>]*data-keep-next[^>]*data-carry-head="entries"/g)).toHaveLength(1);
    expect(html).toContain('Logged by<span class="jsn">Mayur</span>');
    expect(html).toContain('Seen by (Department Admin)');
  });

  it('says which rows are old Break and Others rows', () => {
    const html = build(
      detail({
        entries: [
          entry(),
          entry({ kind: 'break', fromTime: '11:00', toTime: '11:30', description: 'Lunch' }),
          entry({ kind: 'leave', fromTime: '11:30', toTime: '12:00', description: 'Bank' }),
        ],
      }),
    );
    expect(html).toContain('>Break · Lunch<');
    expect(html).toContain('>Others · Bank<');
    expect(html.match(/<tr class="nw"/g)).toHaveLength(2);
  });

  it('leaves an Open entry and a blank day without dashes', () => {
    const open = build(
      detail({
        entries: [entry({ toTime: null })],
        summary: { ...detail().summary, lastStop: '16:12', open: true },
      }),
    );
    expect(open).toContain('Last Stop</span><span class="jv"><');
    const blank = build(
      detail({
        entries: [],
        summary: {
          ...detail().summary,
          firstStart: null,
          lastStop: null,
          workMin: 0,
          entryCount: 0,
        },
      }),
    );
    expect(blank).toContain('First Start</span><span class="jv"><');
    expect(blank).toContain('Working Hours</span><span class="jv k">0h 00m<');
  });

  it('prints no reply, waiting edit or rejection', () => {
    const html = build(
      detail({
        entries: [
          entry({
            replies: [
              {
                id: '00000000-0000-4000-8000-000000000005',
                body: 'SECRET REPLY',
                authorName: 'Admin',
                sentAt: '2026-11-06T06:00:00Z',
                editedAt: null,
                unread: true,
              },
            ],
            rejectReason: 'SECRET REASON',
          }),
        ],
      }),
    );
    expect(html).not.toContain('SECRET');
  });

  it('escapes what people typed', () => {
    const html = build(
      detail({ userName: 'A<b>', entries: [entry({ description: '<img src=x>' })] }),
    );
    expect(html).toContain('A&lt;b&gt;');
    expect(html).not.toContain('<img src=x>');
  });
});
