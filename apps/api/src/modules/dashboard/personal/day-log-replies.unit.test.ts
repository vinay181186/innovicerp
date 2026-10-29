// ADR-255 — a Day Log reply as a Home note, without a database. Run via
// `pnpm --filter @innovic/api test:unit`.

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../db/client', () => ({ db: {} }));

const { dayLogReplyNote } = await import('./day-log-replies');

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
