// Day Log — Working On edited directly, text revisions, Super Admin replies
// (ADR-255), TEST database. Registered by service.test.ts (textCases()) so it
// shares that file's fixture and runs in the same file, one test after another.
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { AuthorizationError, ConflictError, NotFoundError } from '../../lib/errors';
import * as service from './service';
import {
  MON,
  add,
  at,
  fx,
  owner,
  otherSuperAdmin,
  ownerAsSuper,
  revisionsOf,
  sameDeptAdmin,
  superAdmin,
  work,
} from './test-fixture';

const C = at(MON, '17:00');

/** One saved row, as the owner loaded it. */
const saved = async (description = 'test work') =>
  (await add(MON, C, { startTime: '09:00', stopTime: '10:00', description })).entries[0]!;

/** Activity rows of the company that carry `text` anywhere in their detail. */
async function activityWith(text: string): Promise<number> {
  const [r] = (await db.execute(sql`
    SELECT count(*)::int AS n FROM public.activity_log
    WHERE company_id = ${fx.ownerBase.companyId}::uuid AND detail LIKE ${`%${text}%`}
  `)) as unknown as Array<{ n: number }>;
  return Number(r?.n ?? 0);
}

const personDay = (as: Parameters<typeof service.getPersonDay>[1]) =>
  service.getPersonDay({ userId: fx.ownerBase.id, date: MON }, as, C);

export function textCases(): void {
  describe('Day Log — Working On direct edit (ADR-255)', () => {
    it('a new entry has Entry Rev 0; the sheet batch too', async () => {
      const e = await saved();
      expect(await revisionsOf(e.id)).toEqual([{ entry_rev_no: 0, description: 'test work' }]);
      const d = await service.addEntries(
        { date: MON, rows: [{ startTime: '11:00', stopTime: '12:00', description: 'batch row' }] },
        owner(),
        C,
      );
      const b = d.entries.find((x) => x.description === 'batch row')!;
      expect(await revisionsOf(b.id)).toEqual([{ entry_rev_no: 0, description: 'batch row' }]);
    });

    it('a direct edit changes the text at once, keeps Entry Rev 1, writes no activity', async () => {
      const e = await saved();
      const marker = `dl-text-${Date.now()}`;
      const d = await work(e, C, marker);
      const row = d.entries[0]!;
      expect([row.description, row.pending]).toEqual([marker, null]);
      expect(await revisionsOf(e.id)).toEqual([
        { entry_rev_no: 0, description: 'test work' },
        { entry_rev_no: 1, description: marker },
      ]);
      expect(await activityWith(marker)).toBe(0);
      // A second changed save is Rev 2.
      await work(row, C, `${marker}-2`);
      expect((await revisionsOf(e.id)).map((r) => r.entry_rev_no)).toEqual([0, 1, 2]);
    });

    it('the same text is "Nothing changed"; a stale updatedAt is a 409', async () => {
      const e = await saved();
      await expect(work(e, C, '  test work ')).rejects.toThrow('Nothing changed');
      await work(e, C, 'first change');
      await expect(work(e, C, 'second change')).rejects.toBeInstanceOf(ConflictError);
      expect((await revisionsOf(e.id)).map((r) => r.entry_rev_no)).toEqual([0, 1]);
    });

    it('two direct edits at once — exactly one wins; revisions 0 and 1 only', async () => {
      const e = await saved();
      const res = await Promise.allSettled([work(e, C, 'edit A'), work(e, C, 'edit B')]);
      expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const lost = res.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(lost.reason).toBeInstanceOf(ConflictError);
      expect((await revisionsOf(e.id)).map((r) => r.entry_rev_no)).toEqual([0, 1]);
    });

    it('an old Others (leave) row cannot be text-edited', async () => {
      const e = await saved();
      await db.execute(
        sql`UPDATE public.daily_report_lines SET kind = 'leave' WHERE id = ${e.id}::uuid`,
      );
      const row = (await service.getDay({ date: MON }, owner(), C)).entries[0]!;
      await expect(work(row, C, 'new text')).rejects.toThrow('This row cannot be edited');
      expect((await revisionsOf(e.id)).map((r) => r.entry_rev_no)).toEqual([0]);
    });

    it("someone else's entry cannot be text-edited", async () => {
      const e = await saved();
      await expect(
        service.updateWork(e.id, { description: 'x', updatedAt: e.updatedAt }, sameDeptAdmin(), C),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('Day Log — Super Admin replies (ADR-255)', () => {
    it("the owner's day carries replies with unread and NO revision fields", async () => {
      const e = await saved();
      await work(e, C, 'changed once');
      await service.sendReply(e.id, { body: 'Please add the SO' }, superAdmin());
      const day = await service.getDay({ date: MON }, owner(), C);
      const row = day.entries[0]!;
      expect(row.replies).toHaveLength(1);
      expect(row.replies[0]).toMatchObject({
        body: 'Please add the SO',
        unread: true,
        editedAt: null,
      });
      const keys = Object.keys(row).concat(Object.keys(row.replies[0]!));
      for (const k of ['entryRevNo', 'entryRevisedAt', 'revisions', 'seenAt']) {
        expect(keys).not.toContain(k);
      }
    });

    it("someone else's day: a Super Admin sees the replies, an L5 does not", async () => {
      const e = await saved();
      await service.sendReply(e.id, { body: 'for the owner' }, superAdmin());
      const q = { date: MON, userId: fx.ownerBase.id };
      const s = await service.getDay(q, superAdmin(), C);
      expect(s.entries[0]!.replies.map((r) => r.body)).toEqual(['for the owner']);
      const l = await service.getDay(q, sameDeptAdmin(), C);
      expect(l.entries[0]!.replies).toEqual([]);
    });

    it('person-day: a Super Admin sees revisions; an L5 sees none', async () => {
      const e = await saved();
      await work(e, C, 'v1');
      await service.sendReply(e.id, { body: 'ok' }, superAdmin());
      const s = await personDay(superAdmin());
      expect(s.isSuperAdmin).toBe(true);
      const se = s.entries[0]!;
      expect([se.srNo, se.entryRevNo, se.minutes]).toEqual([1, 1, 60]);
      expect(se.entryRevisedAt).not.toBeNull();
      expect(se.revisions.map((r) => [r.entryRevNo, r.description])).toEqual([
        [1, 'v1'],
        [0, 'test work'],
      ]);
      expect(se.replies.map((r) => [r.body, r.seenAt])).toEqual([['ok', null]]);
      const l = await personDay(sameDeptAdmin());
      expect(l.isSuperAdmin).toBe(false);
      expect(l.entries[0]).toMatchObject({
        entryRevNo: null,
        entryRevisedAt: null,
        revisions: [],
        replies: [],
        description: 'v1',
      });
    });

    it('a non-Super Admin cannot reply; nobody replies on their own entry', async () => {
      const e = await saved();
      await expect(service.sendReply(e.id, { body: 'hi' }, sameDeptAdmin())).rejects.toBeInstanceOf(
        AuthorizationError,
      );
      await expect(service.sendReply(e.id, { body: 'hi' }, ownerAsSuper())).rejects.toBeInstanceOf(
        AuthorizationError,
      );
    });

    it('mark seen: a non-owner is refused; the owner sets it once', async () => {
      const e = await saved();
      await service.sendReply(e.id, { body: 'one' }, superAdmin());
      await service.sendReply(e.id, { body: 'two' }, superAdmin());
      await expect(service.markRepliesSeen(e.id, sameDeptAdmin())).rejects.toBeInstanceOf(
        NotFoundError,
      );
      expect(await service.markRepliesSeen(e.id, owner())).toEqual({ seen: 2 });
      expect(await service.markRepliesSeen(e.id, owner())).toEqual({ seen: 0 });
      const day = await service.getDay({ date: MON }, owner(), C);
      expect(day.entries[0]!.replies.map((r) => r.unread)).toEqual([false, false]);
    });

    it('only the author edits a reply', async () => {
      const other = otherSuperAdmin();
      if (!other) return; // TEST has no third user
      const e = await saved();
      const r = await service.sendReply(e.id, { body: 'mine' }, superAdmin());
      await expect(
        service.editReply(r.id, { body: 'theirs', updatedAt: r.updatedAt }, other),
      ).rejects.toThrow('Only the person who sent this reply can edit it');
    });

    it('editing a reply resets seen; a stale or unchanged edit is refused', async () => {
      const e = await saved();
      const r = await service.sendReply(e.id, { body: 'first' }, superAdmin());
      await service.markRepliesSeen(e.id, owner());
      expect((await personDay(superAdmin())).entries[0]!.replies[0]!.seenAt).not.toBeNull();
      await expect(
        service.editReply(r.id, { body: 'first', updatedAt: r.updatedAt }, superAdmin()),
      ).rejects.toThrow('Nothing changed');
      const ed = await service.editReply(
        r.id,
        { body: 'second', updatedAt: r.updatedAt },
        superAdmin(),
      );
      expect([ed.body, ed.seenAt]).toEqual(['second', null]);
      expect(ed.editedAt).not.toBeNull();
      await expect(
        service.editReply(r.id, { body: 'third', updatedAt: r.updatedAt }, superAdmin()),
      ).rejects.toBeInstanceOf(ConflictError);
      const day = await service.getDay({ date: MON }, owner(), C);
      expect(day.entries[0]!.replies[0]).toMatchObject({ body: 'second', unread: true });
    });
  });
}
