// Day Log — Pending Entries and replies on a blank day (owner 2026-11-05), TEST
// database. Registered by service.test.ts (pendingCases()) so it shares that
// file's fixture. Runs in January 2040 with the company's day_log_pending_from set
// there (restored after), so a login's real creation date and real days never come
// into it; wipeOwnerDays clears 2040.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { AuthorizationError, ConflictError } from '../../lib/errors';
import * as service from './service';
import { type DayLogClock } from './rules';
import {
  fx,
  otherSuperAdmin,
  owner,
  ownerAsSuper,
  sameDeptAdmin,
  superAdmin,
} from './test-fixture';

// 02-Jan-2040 is a Monday; 07-Jan a Saturday; 08-Jan a Sunday.
const MON = '2040-01-02';
const TUE = '2040-01-03';
const WED = '2040-01-04';
const clock = (today: string): DayLogClock => ({ today, nowMin: 12 * 60 });
const THU_CLOCK = clock('2040-01-05');

const reply = (date: string, body = 'Please enter this day', as = superAdmin()) =>
  service.sendDayReply({ userId: fx.ownerBase.id, date, body }, as, THU_CLOCK);

const entry = (date: string, c: DayLogClock = THU_CLOCK) =>
  service.addEntry(
    { date, kind: 'work', description: 'x', startTime: '09:00', stopTime: '10:00' },
    owner(),
    c,
  );

/** The day's tasks: [code, status, viewed]. */
async function tasksOf(date: string) {
  const rows = (await db.execute(sql`
    SELECT t.code, t.status, t.viewed_at IS NOT NULL AS viewed, t.title, t.description
    FROM public.tasks t
    JOIN public.daily_reports dr ON dr.id::text = t.linked_ref_id
    WHERE t.linked_ref_type = 'day_log_date' AND t.deleted_at IS NULL
      AND dr.user_id = ${fx.ownerBase.id}::uuid AND dr.report_date = ${date}::date
    ORDER BY t.created_at
  `)) as unknown as Array<{
    code: string;
    status: string;
    viewed: boolean;
    title: string;
    description: string;
  }>;
  return rows;
}

const mine = (c: DayLogClock = THU_CLOCK) => service.getMyPending(owner(), c);

const myRows = async (c: DayLogClock = THU_CLOCK) =>
  (await service.getPending(superAdmin(), c)).rows.filter((r) => r.userId === fx.ownerBase.id);

const personDay = (as: Parameters<typeof service.getPersonDay>[1], date: string) =>
  service.getPersonDay({ userId: fx.ownerBase.id, date }, as, THU_CLOCK);

/** Set the company's first pending date; returns what it was. */
async function setCompanyFrom(date: string): Promise<string> {
  const [r] = (await db.execute(sql`
    WITH old AS (
      SELECT day_log_pending_from AS d FROM public.companies
      WHERE id = ${fx.ownerBase.companyId}::uuid),
    w AS (
      UPDATE public.companies SET day_log_pending_from = ${date}::date
      WHERE id = ${fx.ownerBase.companyId}::uuid)
    SELECT to_char(old.d, 'YYYY-MM-DD') AS d FROM old
  `)) as unknown as Array<{ d: string }>;
  return r!.d;
}

export function pendingCases(): void {
  let companyFrom = '';
  beforeAll(async () => {
    companyFrom = await setCompanyFrom(MON);
  });
  afterAll(async () => {
    await setCompanyFrom(companyFrom);
  });

  describe('Day Log — Pending Entries', () => {
    it('a blank working day before today is pending; today is not', async () => {
      expect((await mine()).dates).toEqual([MON, TUE, WED]);
      const row = (await myRows())[0]!;
      expect(row).toMatchObject({ date: MON, daysPending: 3, taskCode: null, replyCount: 0 });
    });

    it('Sunday is skipped; the result lists only blank dates, oldest first', async () => {
      await entry(TUE, clock('2040-01-10'));
      expect((await mine(clock('2040-01-10'))).dates).toEqual([
        MON,
        WED,
        '2040-01-05',
        '2040-01-06',
        '2040-01-07',
        '2040-01-09',
      ]);
    });

    it('the calendar: red = the banner, green = saved, dot = replied; Super Admin only', async () => {
      await entry(TUE);
      await reply(MON);
      const c = await service.getPendingCalendar(fx.ownerBase.id, superAdmin(), THU_CLOCK);
      expect(c.pending).toEqual((await mine()).dates);
      expect(c.pending).toEqual([MON, WED]);
      expect(c.filled).toEqual([TUE]);
      expect(c.replied).toEqual([MON]);
      expect(c.firstMonth).toBe(MON.slice(0, 7));
      await expect(service.getPendingCalendar(fx.ownerBase.id, owner(), THU_CLOCK)).rejects.toThrow(
        'Only a Super Admin',
      );
      await expect(
        service.getPendingCalendar('00000000-0000-4000-8000-000000000000', superAdmin(), THU_CLOCK),
      ).rejects.toThrow('does not keep a Day Log');
    });

    it('a part-filled day is not pending', async () => {
      await entry(MON);
      expect((await mine()).dates).toEqual([TUE, WED]);
    });

    it('a holiday is not pending', async () => {
      const h = await service.addHoliday({ date: TUE, name: 'Test holiday' }, superAdmin());
      try {
        expect((await mine()).dates).toEqual([MON, WED]);
      } finally {
        await service.deleteHoliday(h.id, superAdmin());
      }
    });

    it('a new login starts on the day it was created', async () => {
      const [u] = (await db.execute(sql`
        SELECT created_at FROM public.users WHERE id = ${fx.ownerBase.id}::uuid
      `)) as unknown as Array<{ created_at: Date | string }>;
      await db.execute(sql`
        UPDATE public.users SET created_at = ${`${TUE}T12:00:00+05:30`}::timestamptz
        WHERE id = ${fx.ownerBase.id}::uuid`);
      try {
        expect((await mine()).dates).toEqual([TUE, WED]);
      } finally {
        const was = new Date(String(u!.created_at)).toISOString();
        await db.execute(sql`
          UPDATE public.users SET created_at = ${was}::timestamptz
          WHERE id = ${fx.ownerBase.id}::uuid`);
      }
    });

    it('a Super Admin is never pending, and not on the list', async () => {
      expect((await service.getMyPending(fx.admin, THU_CLOCK)).dates).toEqual([]);
      const all = await service.getPending(superAdmin(), THU_CLOCK);
      expect(all.rows.some((r) => r.userId === fx.admin.id)).toBe(false);
    });

    it('only a Super Admin reads the list', async () => {
      await expect(service.getPending(sameDeptAdmin(), THU_CLOCK)).rejects.toBeInstanceOf(
        AuthorizationError,
      );
      expect((await service.getAccess(superAdmin())).canSeePending).toBe(true);
      expect((await service.getAccess(sameDeptAdmin())).canSeePending).toBe(false);
    });

    it('team row: notEntered and dayReplyCount for a Super Admin only', async () => {
      await reply(MON);
      const row = async (as: Parameters<typeof service.getTeam>[1]) =>
        (await service.getTeam({ date: MON }, as, THU_CLOCK)).rows.find(
          (r) => r.userId === fx.ownerBase.id,
        )!;
      expect(await row(superAdmin())).toMatchObject({ notEntered: true, dayReplyCount: 1 });
      expect(await row(sameDeptAdmin())).toMatchObject({ notEntered: false, dayReplyCount: 0 });
    });
  });

  describe('Day Log — replies on a blank day', () => {
    it('a reply opens the day and raises one task; a second reply adds none', async () => {
      await reply(MON, 'first');
      await reply(MON, 'second');
      const t = await tasksOf(MON);
      expect(t).toHaveLength(1);
      expect(t[0]).toMatchObject({
        status: 'todo',
        viewed: false,
        title: 'Day Log 02-01-2040 not entered',
        description: 'Enter your Day Log for 02-01-2040.',
      });
      expect((await myRows())[0]).toMatchObject({
        date: MON,
        taskCode: t[0]!.code,
        replyCount: 2,
        unseenCount: 2,
      });
      // A blank header is still a blank day.
      expect((await mine()).dates).toContain(MON);
    });

    it('canEdit: the author yes, anyone else no', async () => {
      const r = await reply(MON);
      expect(r.canEdit).toBe(true);
      expect((await personDay(superAdmin(), MON)).dayReplies[0]!.canEdit).toBe(true);
      const other = otherSuperAdmin();
      if (other) expect((await personDay(other, MON)).dayReplies[0]!.canEdit).toBe(false);
    });

    it('two replies at once: both save, one task', async () => {
      const res = await Promise.allSettled([reply(TUE, 'a'), reply(TUE, 'b')]);
      expect(res.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
      expect((await myRows()).find((r) => r.date === TUE)?.replyCount).toBe(2);
      expect(await tasksOf(TUE)).toHaveLength(1);
    });

    it('saving an entry closes the task, in one row and the sheet alike', async () => {
      await reply(MON);
      await entry(MON);
      expect((await tasksOf(MON))[0]!.status).toBe('completed');
      await reply(TUE);
      await service.addEntries(
        { date: TUE, rows: [{ startTime: '09:00', stopTime: '10:00', description: 'x' }] },
        owner(),
        THU_CLOCK,
      );
      expect((await tasksOf(TUE))[0]!.status).toBe('completed');
    });

    it('a reply after the entry is saved is a 409', async () => {
      await entry(MON);
      await expect(reply(MON)).rejects.toBeInstanceOf(ConflictError);
      expect(await tasksOf(MON)).toEqual([]);
    });

    it('a non-Super Admin is refused and nothing stays behind', async () => {
      await expect(reply(MON, 'x', sameDeptAdmin())).rejects.toBeInstanceOf(AuthorizationError);
      const [r] = (await db.execute(sql`
        SELECT count(*)::int AS n FROM public.daily_reports
        WHERE user_id = ${fx.ownerBase.id}::uuid AND report_date = ${MON}::date
      `)) as unknown as Array<{ n: number }>;
      expect(r?.n).toBe(0);
    });

    it('nobody replies on their own day', async () => {
      await expect(reply(MON, 'x', ownerAsSuper())).rejects.toBeInstanceOf(AuthorizationError);
    });

    it('before the start date: refused, and no Reply box', async () => {
      const friday = '2039-12-30';
      await expect(reply(friday)).rejects.toThrow('Day Log start');
      expect((await personDay(superAdmin(), friday)).canReplyDay).toBe(false);
    });

    it('an Auditor is never asked: refused, and no Reply box', async () => {
      const setAuditor = (on: boolean) =>
        db.execute(sql`
          UPDATE public.user_access SET auditor = ${on}
          WHERE user_id = ${fx.ownerBase.id}::uuid AND deleted_at IS NULL`);
      await setAuditor(true);
      try {
        await expect(reply(MON)).rejects.toThrow('is not asked to keep a Day Log');
        expect((await personDay(superAdmin(), MON)).canReplyDay).toBe(false);
      } finally {
        await setAuditor(false);
      }
    });

    it('a future day and a Sunday are refused', async () => {
      await expect(reply('2040-01-06')).rejects.toThrow('has not come yet');
      const sunday = service.sendDayReply(
        { userId: fx.ownerBase.id, date: '2040-01-08', body: 'x' },
        superAdmin(),
        clock('2040-01-09'),
      );
      await expect(sunday).rejects.toThrow('is not a working day');
    });

    it('the owner marks seen once; an edit resets it and the task reads New', async () => {
      const r = await reply(MON);
      await db.execute(sql`
        UPDATE public.tasks SET viewed_at = now()
        WHERE code = ${(await tasksOf(MON))[0]!.code}
          AND company_id = ${fx.ownerBase.companyId}::uuid`);
      const asOwner = await service.getDay({ date: MON }, owner(), THU_CLOCK);
      expect(asOwner.dayReplies.map((d) => [d.body, d.unread])).toEqual([
        ['Please enter this day', true],
      ]);
      expect(await service.markDayRepliesSeen({ date: MON }, sameDeptAdmin())).toEqual({ seen: 0 });
      expect(await service.markDayRepliesSeen({ date: MON }, owner())).toEqual({ seen: 1 });
      expect(await service.markDayRepliesSeen({ date: MON }, owner())).toEqual({ seen: 0 });

      const ed = await service.editDayReply(
        r.id,
        { body: 'Changed', updatedAt: r.updatedAt },
        superAdmin(),
      );
      expect([ed.body, ed.seenAt]).toEqual(['Changed', null]);
      expect((await tasksOf(MON))[0]!.viewed).toBe(false);
      await expect(
        service.editDayReply(r.id, { body: 'Stale', updatedAt: r.updatedAt }, superAdmin()),
      ).rejects.toBeInstanceOf(ConflictError);
      const again = await service.getDay({ date: MON }, owner(), THU_CLOCK);
      expect(again.dayReplies[0]).toMatchObject({ body: 'Changed', unread: true });
    });

    it('only the owner sees them on My Day Log; a viewer of the day gets []', async () => {
      await reply(MON);
      const q = { date: MON, userId: fx.ownerBase.id };
      expect((await service.getDay(q, superAdmin(), THU_CLOCK)).dayReplies).toEqual([]);
    });
  });

  describe('Day Log — person-day and Log Time', () => {
    it('a blank day: Super Admin sees dayReplies and may reply; others see no reply fact', async () => {
      await reply(MON);
      const s = await personDay(superAdmin(), MON);
      expect([s.canReplyDay, s.notEntered]).toEqual([true, true]);
      expect(s.dayReplies.map((d) => [d.body, d.seenAt])).toEqual([
        ['Please enter this day', null],
      ]);
      const l = await personDay(sameDeptAdmin(), MON);
      expect([l.canReplyDay, l.dayReplies, l.notEntered]).toEqual([false, [], false]);
      const own = await personDay(ownerAsSuper(), MON);
      expect(own.canReplyDay).toBe(false);
    });

    it('a day with an entry: no reply box, not Not entered; revisions stay Super-only', async () => {
      await entry(MON);
      const s = await personDay(superAdmin(), MON);
      expect([s.canReplyDay, s.notEntered]).toEqual([false, false]);
      const l = await personDay(sameDeptAdmin(), MON);
      expect(l.entries[0]).toMatchObject({ revisions: [], replies: [], entryRevNo: null });
      expect(l.dayReplies).toEqual([]);
    });

    it('loggedAt is the first save; an edit does not move it, every viewer gets it', async () => {
      const d = await entry(MON);
      const e = d.entries[0]!;
      expect(e.loggedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      const after = await service.updateWork(
        e.id,
        { description: 'edited', updatedAt: e.updatedAt },
        owner(),
        THU_CLOCK,
      );
      expect(after.entries[0]!.loggedAt).toBe(e.loggedAt);
      expect((await personDay(sameDeptAdmin(), MON)).entries[0]!.loggedAt).toBe(e.loggedAt);
    });
  });
}
