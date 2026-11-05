// ADR-255 — a Day Log reply as a Home note, without a database. Run via
// `pnpm --filter @innovic/api test:unit`.

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../db/client', () => ({ db: {} }));

const { dayLogDayReplyNote, dayLogPendingNote, dayLogReplyNote, dayLogTeamPendingNote } =
  await import('./day-log-replies');

const base = {
  id: '11111111-1111-1111-1111-111111111111',
  lineId: '22222222-2222-2222-2222-222222222222',
  date: '2026-10-28',
  srNo: 3,
  author: 'Vinay',
  body: 'Please add the SO number',
  sentAt: '2026-10-29T05:00:00.000Z',
  editedAt: null,
  updatedAt: '2026-10-29T05:00:00.123Z',
};

describe('Day Log reply note', () => {
  it('a new reply: text, link, key, tone, always unseen', () => {
    const n = dayLogReplyNote(base);
    expect(n).toEqual({
      key: `dlr:${base.id}:${Date.parse(base.updatedAt)}`,
      ts: base.sentAt,
      tone: 'due',
      unseen: true,
      text: [
        { text: 'Vinay replied on your Day Log · ' },
        {
          code: '28-10-2026 · entry 3',
          href: `/task-board?view=daylog&date=2026-10-28&line=${base.lineId}`,
        },
        { text: ' — “Please add the SO number”' },
      ],
    });
  });

  it('an edited reply: "edited a reply on", ts = edited time, a new key', () => {
    const n = dayLogReplyNote({
      ...base,
      editedAt: '2026-10-29T06:00:00.000Z',
      updatedAt: '2026-10-29T06:00:00.000Z',
    });
    expect(n.text[0]).toEqual({ text: 'Vinay edited a reply on your Day Log · ' });
    expect(n.ts).toBe('2026-10-29T06:00:00.000Z');
    expect(n.key).not.toBe(dayLogReplyNote(base).key);
  });

  it('a long body is cut at 60 characters with …', () => {
    const long = 'x'.repeat(61);
    expect(dayLogReplyNote({ ...base, body: long }).text[2]).toEqual({
      text: ` — “${'x'.repeat(60)}…”`,
    });
    expect(dayLogReplyNote({ ...base, body: 'y'.repeat(60) }).text[2]).toEqual({
      text: ` — “${'y'.repeat(60)}”`,
    });
  });
});

describe('Pending Entries notes', () => {
  const NOW = '2026-11-05T06:00:00.000Z';

  it('a reply on a blank day: same words, its own key, links to the date', () => {
    const n = dayLogDayReplyNote({
      id: 'r1',
      date: '2026-11-03',
      author: 'Jinal',
      body: 'Please enter this',
      sentAt: NOW,
      editedAt: null,
      updatedAt: NOW,
    });
    expect(n.key).toBe(`dlr:d:r1:${Date.parse(NOW)}`);
    expect(n.text).toEqual([
      { text: 'Jinal replied on your Day Log · ' },
      { code: '03-11-2026', href: '/task-board?view=daylog&date=2026-11-03' },
      { text: ' — “Please enter this”' },
    ]);
  });

  it('a person: lists the dates, links to the oldest, key carries the count', () => {
    const n = dayLogPendingNote(['2026-11-02', '2026-11-04'], NOW);
    expect(n.key).toBe('dlp:me:2:2026-11-02');
    expect(n.text).toEqual([
      { text: 'Day Log — 2 days not entered · ' },
      { code: '02-11-2026, 04-11-2026', href: '/task-board?view=daylog&date=2026-11-02' },
    ]);
    expect(dayLogPendingNote(['2026-11-02'], NOW).text[0]).toEqual({
      text: 'Day Log — 1 day not entered · ',
    });
  });

  it('a Super Admin: counts the people, key carries the count', () => {
    const n = dayLogTeamPendingNote(3, NOW);
    expect(n.key).toBe('dlp:team:3');
    expect(n.text).toEqual([
      { code: 'Day Log — 3 people have pending entries', href: '/task-board?view=pending' },
    ]);
  });
});
