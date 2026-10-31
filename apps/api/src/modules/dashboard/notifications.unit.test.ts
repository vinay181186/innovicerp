// ADR-262 — the bell's read state without a database. Run via
// `pnpm --filter @innovic/api test:unit`.

import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../db/client', () => ({ db: {} }));
vi.mock('../access-control/service', () => ({ getMyAccess: vi.fn() }));
vi.mock('../purchase-requests/service', () => ({ orderedQtySql: () => sql`0` }));

const { applyReadState, toNotificationsResponse } = await import('./notifications-service');

const note = (key: string, ts: string) => ({
  key,
  ts,
  tone: 'due' as const,
  actorName: 'Rakesh',
  text: [{ text: `event ${key}` }],
  unseen: true,
});

const NOTES = [
  note('a', '2026-10-30T05:00:00.000Z'),
  note('b', '2026-10-31T05:00:00.000Z'),
  note('c', '2026-10-31T09:00:00.000Z'),
];

describe('bell read state', () => {
  it('no explicit row: read = on or before the seen time', () => {
    const items = applyReadState(NOTES, new Map(), '2026-10-31T05:00:00.000Z');
    expect(items.map((n) => [n.key, n.read])).toEqual([
      ['c', false],
      ['b', true],
      ['a', true],
    ]);
  });

  it('an explicit row wins over the seen time, both ways', () => {
    const explicit = new Map([
      ['a', false], // marked unread again, though before seenAt
      ['c', true], // marked read, though after seenAt
    ]);
    const items = applyReadState(NOTES, explicit, '2026-10-31T05:00:00.000Z');
    expect(Object.fromEntries(items.map((n) => [n.key, n.read]))).toEqual({
      a: false,
      b: true,
      c: true,
    });
  });

  it('never seen and no rows: everything unread', () => {
    expect(applyReadState(NOTES, new Map(), null).every((n) => !n.read)).toBe(true);
  });

  it('"Mark all as read" up to b leaves the later event c unread', () => {
    // read-all moves seenAt to upTo and flips explicit rows <= upTo to read.
    const upTo = '2026-10-31T05:00:00.000Z';
    const items = applyReadState(NOTES, new Map([['a', true]]), upTo);
    expect(items.find((n) => n.key === 'c')!.read).toBe(false);
    expect(items.filter((n) => n.read).map((n) => n.key)).toEqual(['b', 'a']);
  });

  it('unread / total count the whole window, whatever the filter and limit', () => {
    const items = applyReadState(NOTES, new Map(), '2026-10-31T05:00:00.000Z');
    const unreadOnly = toNotificationsResponse(items, { filter: 'unread', limit: 6 });
    expect(unreadOnly.items.map((n) => n.key)).toEqual(['c']);
    expect(unreadOnly).toMatchObject({ unread: 1, total: 3 });
    const readOne = toNotificationsResponse(items, { filter: 'read', limit: 1 });
    expect(readOne.items.map((n) => n.key)).toEqual(['b']);
    expect(readOne).toMatchObject({ unread: 1, total: 3 });
  });

  it('items carry the actor and no "unseen" field', () => {
    const [first] = applyReadState(NOTES, new Map(), null);
    expect(first).toMatchObject({ actorName: 'Rakesh' });
    expect(first).not.toHaveProperty('unseen');
  });
});
