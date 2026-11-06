// Day Log — History (ADR-278), TEST database. Registered by service.test.ts
// (personHistoryCases()) so it shares that file's fixture. Runs in January 2040:
// pendingCases() sets the company's day_log_pending_from to 02-Jan-2040 for the
// whole file, and wipeOwnerDays clears 2040 before each test.
import { type DayLogDetail, dayLogHistoryQuerySchema } from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import type { AuthContext } from '../../db/with-user-context';
import { AuthorizationError, NotFoundError, ValidationError } from '../../lib/errors';
import { asAccess } from '../../lib/test-access';
import { errorHandlerPlugin } from '../../plugins/error-handler';
import { dayLogsRoutes } from './routes';
import * as service from './service';

async function appAs(user: AuthContext | null): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    if (user) req.user = user;
  });
  await app.register(errorHandlerPlugin);
  await app.register(dayLogsRoutes);
  return app;
}
import {
  add,
  at,
  fx,
  owner,
  ownerAsSuper,
  sameDeptAdmin,
  stagePending,
  superAdmin,
  teamRow,
  work,
} from './test-fixture';

// 01-Jan-2040 is a Sunday; today is Tuesday 10-Jan, noon.
const SUN1 = '2040-01-01';
const MON = '2040-01-02';
const TUE = '2040-01-03';
const WED = '2040-01-04';
const THU = '2040-01-05';
const FRI = '2040-01-06';
const SUN2 = '2040-01-08';
const TODAY = '2040-01-10';
const MONTH = '2040-01';
const C = at(TODAY, '12:00');

const history = (
  q: { month: string } | { date: string } = { month: MONTH },
  as: AuthContext = superAdmin(),
  clock = C,
) => service.getPersonHistory({ userId: fx.ownerBase.id, ...q }, as, clock);

const dayIn = (h: Awaited<ReturnType<typeof history>>, date: string) =>
  h.days.find((d) => d.date === date)!;

const lineAt = (d: DayLogDetail, from: string) => d.entries.find((e) => e.fromTime === from)!;

/** Change a stored line as an old row would have it. */
const setLine = (id: string, set: SQL) =>
  db.execute(sql`UPDATE public.daily_report_lines SET ${set} WHERE id = ${id}::uuid`);

const dayReply = (date: string, body = 'Please enter this day') =>
  service.sendDayReply({ userId: fx.ownerBase.id, date, body }, superAdmin(), C);

/** The seed admin's id as a plain viewer: no Full Access, no L5 anywhere. */
const plainAdmin = (): AuthContext =>
  asAccess(fx.admin, { departments: { [fx.otherDept]: 'L1', tasks: 'L1' } }, 'manager');
const auditor = (): AuthContext =>
  asAccess(fx.admin, { auditor: true, departments: { tasks: 'L1' } }, 'manager');

export function personHistoryCases(): void {
  describe('Day Log — History figures', () => {
    it('month totals are the sum of the days, and each day agrees with Team and the person page', async () => {
      await add(MON, C, { startTime: '14:00', stopTime: '14:30' });
      await add(MON, C, { startTime: '09:00', stopTime: '10:00' });
      await add(WED, C, { startTime: '09:00', stopTime: '11:00' });
      await add(TODAY, C, { startTime: '09:00', stopTime: '10:00' });

      const h = await history();
      expect([h.userId, h.month, h.date, h.today]).toEqual([fx.ownerBase.id, MONTH, null, TODAY]);
      expect(h.days.map((d) => d.date)).toEqual(
        Array.from({ length: 10 }, (_, i) => `2040-01-${String(i + 1).padStart(2, '0')}`),
      );
      expect(h.days.map((d) => d.state)).toEqual([
        'sunday',
        'filled',
        'not_entered',
        'filled',
        'not_entered',
        'not_entered',
        'not_entered',
        'sunday',
        'not_entered',
        'today',
      ]);
      expect(h.totals).toEqual({
        workingDays: 8,
        filledDays: 3,
        notEntered: 5,
        offDays: 2,
        leaveDays: 0,
        entries: 4,
        workMin: 270,
        breakMin: 0,
        leaveMin: 0,
        editedEntries: 0,
        edits: 0,
        replies: 0,
        savedLater: 0,
      });
      expect(h.hasContent).toBe(true);

      const mon = dayIn(h, MON);
      expect([mon.firstStart, mon.lastStop, mon.workMin, mon.entryCount]).toEqual([
        '09:00',
        '14:30',
        90,
        2,
      ]);
      expect(mon.entries.map((e) => [e.srNo, e.fromTime, e.minutes])).toEqual([
        [1, '09:00', 60],
        [2, '14:00', 30],
      ]);

      for (const d of h.days) {
        const team = await teamRow(d.date, C);
        expect([d.firstStart, d.lastStop, d.workMin, d.entryCount]).toEqual([
          team.firstStart,
          team.lastStop,
          team.workMin,
          team.entryCount,
        ]);
        const person = await service.getPersonDay(
          { userId: fx.ownerBase.id, date: d.date },
          superAdmin(),
          C,
        );
        expect(d.entries).toEqual(person.entries.map((e) => expect.objectContaining(e)));
        expect(d.entries).toHaveLength(person.entries.length);
        expect(d.state === 'not_entered').toBe(person.notEntered);
      }
    });

    it('old break / leave rows stay in the entries but out of Working hours', async () => {
      await add(MON, C, { startTime: '09:00', stopTime: '10:00' });
      await add(MON, C, { startTime: '10:00', stopTime: '10:30' });
      const d = await add(MON, C, { startTime: '11:00', stopTime: '12:00' });
      await setLine(lineAt(d, '10:00').id, sql`kind = 'break'`);
      await setLine(lineAt(d, '11:00').id, sql`kind = 'leave'`);

      const h = await history();
      const mon = dayIn(h, MON);
      expect(mon.entries.map((e) => [e.srNo, e.kind, e.minutes])).toEqual([
        [1, 'work', 60],
        [2, 'break', 30],
        [3, 'leave', 60],
      ]);
      // A leave row is not "in": Last stop is the break's.
      expect([mon.workMin, mon.entryCount, mon.firstStart, mon.lastStop]).toEqual([
        60,
        1,
        '09:00',
        '10:30',
      ]);
      expect(h.totals).toMatchObject({ entries: 1, workMin: 60, breakMin: 30, leaveMin: 60 });
      expect((await teamRow(MON, C)).workMin).toBe(60);
    });

    it('Sunday, holiday, and a Sunday / holiday with entries is filled', async () => {
      await add(SUN2, C, { startTime: '09:00', stopTime: '10:00' });
      await add(FRI, C, { startTime: '09:00', stopTime: '10:00' });
      const blank = await service.addHoliday({ date: THU, name: 'Blank holiday' }, superAdmin());
      const worked = await service.addHoliday({ date: FRI, name: 'Worked holiday' }, superAdmin());
      try {
        const h = await history();
        const facts = (date: string) => {
          const d = dayIn(h, date);
          return [d.state, d.holidayName];
        };
        expect(facts(SUN1)).toEqual(['sunday', null]);
        expect(facts(SUN2)).toEqual(['filled', null]);
        expect(facts(THU)).toEqual(['holiday', 'Blank holiday']);
        expect(facts(FRI)).toEqual(['filled', 'Worked holiday']);
        // Off: 01-Jan and the blank holiday. Filled: Sunday 08 and the worked holiday.
        expect(h.totals).toMatchObject({ offDays: 2, filledDays: 2 });
      } finally {
        await service.deleteHoliday(blank.id, superAdmin());
        await service.deleteHoliday(worked.id, superAdmin());
      }
    });

    it('not entered from the start date; not counted before it or for a Super Admin', async () => {
      const blank = await history({ date: TUE });
      expect(blank.days.map((d) => d.state)).toEqual(['not_entered']);
      expect([blank.month, blank.date]).toEqual([null, TUE]);
      expect(blank.totals).toMatchObject({ workingDays: 1, filledDays: 0, notEntered: 1 });
      expect(blank.hasContent).toBe(true);

      // A Friday before 02-Jan-2040.
      const before = await history({ date: '2039-12-30' });
      expect(before.days.map((d) => d.state)).toEqual(['not_counted']);
      expect(before.totals.workingDays).toBe(0);
      expect(before.hasContent).toBe(false);

      const keepsNone = await service.getPersonHistory(
        { userId: fx.admin.id, date: TUE },
        superAdmin(),
        C,
      );
      expect(keepsNone.days.map((d) => d.state)).toEqual(['not_counted']);
    });

    it('an old Leave day is leave; its day replies count', async () => {
      await dayReply(TUE, 'first');
      await dayReply(TUE, 'second');
      const h1 = dayIn(await history(), TUE);
      expect(h1.state).toBe('not_entered');
      expect(h1.dayReplies.map((r) => r.body)).toEqual(['first', 'second']);
      expect(h1.replies).toBe(2);
      await db.execute(sql`
        UPDATE public.daily_reports SET day_status = 'leave'
        WHERE user_id = ${fx.ownerBase.id}::uuid AND report_date = ${TUE}::date`);
      const h = await history();
      expect(dayIn(h, TUE).state).toBe('leave');
      // Blank before today, TUE now on leave: 02, 04, 05, 06, 07, 09.
      expect(h.totals).toMatchObject({ notEntered: 6, replies: 2, leaveDays: 1 });
      // Only the Leave date picked: its replies can still be printed.
      expect((await history({ date: TUE })).hasContent).toBe(true);
    });

    it('today: an open entry counts to now; a blank today is not filled', async () => {
      const empty = await history({ date: TODAY });
      expect(empty.days.map((d) => d.state)).toEqual(['today']);
      expect(empty.totals).toMatchObject({ filledDays: 0, workingDays: 0 });
      expect(empty.hasContent).toBe(false);

      const d = await add(TODAY, C, { startTime: '09:00', stopTime: '10:00' });
      await setLine(d.entries[0]!.id, sql`to_time = NULL`);
      const h = await history({ date: TODAY });
      const day = h.days[0]!;
      expect([day.state, day.workMin, day.lastStop, day.entries[0]!.minutes]).toEqual([
        'today',
        180,
        '12:00',
        180,
      ]);
      expect(h.totals).toMatchObject({ filledDays: 1, workingDays: 1, workMin: 180 });
    });

    it('an earlier open entry counts 0; an old line with no time is filled but no entry', async () => {
      const open = await add(MON, C, { startTime: '09:00', stopTime: '10:00' });
      await setLine(open.entries[0]!.id, sql`to_time = NULL`);
      const untimed = await add(TUE, C, { startTime: '09:00', stopTime: '10:00' });
      await setLine(untimed.entries[0]!.id, sql`from_time = NULL, to_time = NULL`);

      const h = await history();
      expect([
        dayIn(h, MON).state,
        dayIn(h, MON).entries[0]!.minutes,
        dayIn(h, MON).workMin,
      ]).toEqual(['filled', 0, 0]);
      const tue = dayIn(h, TUE);
      expect([tue.state, tue.entries, tue.entryCount, tue.firstStart]).toEqual([
        'filled',
        [],
        0,
        null,
      ]);
      expect(h.totals.filledDays).toBe(2);
    });

    it('saved later reads the India date: 23:30 UTC is the next day', async () => {
      const tue = await add(TUE, C, { startTime: '09:00', stopTime: '10:00' });
      const tue2 = await add(TUE, C, { startTime: '11:00', stopTime: '12:00' });
      const wed = await add(WED, C, { startTime: '09:00', stopTime: '10:00' });
      const savedAt = (id: string, iso: string) =>
        setLine(id, sql`created_at = ${iso}::timestamptz`);
      // 04-Jan 05:00 India: a day after its date, though still 03-Jan in UTC.
      await savedAt(lineAt(tue, '09:00').id, `${TUE}T23:30:00Z`);
      // 03-Jan 23:30 India: the same day.
      await savedAt(lineAt(tue2, '11:00').id, `${TUE}T18:00:00Z`);
      // 04-Jan 05:00 India: its own date, though still 03-Jan in UTC.
      await savedAt(lineAt(wed, '09:00').id, `${TUE}T23:30:00Z`);

      const h = await history();
      expect(dayIn(h, TUE).savedLater).toBe(1);
      expect(dayIn(h, WED).savedLater).toBe(0);
      expect(h.totals.savedLater).toBe(1);
    });
  });

  describe('Day Log — History revisions and replies', () => {
    /** One edited entry on MON with a Super Admin reply. */
    async function editedEntry() {
      const d = await add(MON, C, { startTime: '09:00', stopTime: '10:00', description: 'first' });
      const after = await work(d.entries[0]!, C, 'edited');
      const e = after.entries[0]!;
      await service.sendReply(e.id, { body: 'Please add the SO' }, superAdmin());
      return e;
    }

    it("someone else's entry: revisions newest first, replies, totals", async () => {
      await editedEntry();
      const h = await history();
      const mon = dayIn(h, MON);
      const e = mon.entries[0]!;
      expect(e.entryRevNo).toBe(1);
      expect(e.entryRevisedAt).not.toBeNull();
      expect(e.revisions.map((r) => [r.entryRevNo, r.description])).toEqual([
        [1, 'edited'],
        [0, 'first'],
      ]);
      expect(e.replies.map((r) => [r.body, r.canEdit])).toEqual([['Please add the SO', true]]);
      expect([e.kind, e.pending]).toEqual(['work', null]);
      expect([mon.edits, mon.replies]).toEqual([1, 1]);
      expect(h.totals).toMatchObject({ editedEntries: 1, edits: 1, replies: 1 });
    });

    it('own entries: revisions yes, replies none', async () => {
      await editedEntry();
      const h = await history({ month: MONTH }, ownerAsSuper());
      const mon = dayIn(h, MON);
      expect(mon.entries[0]!.revisions.map((r) => r.entryRevNo)).toEqual([1, 0]);
      expect(mon.entries[0]!.replies).toEqual([]);
      expect(mon.replies).toBe(0);
      expect(h.totals.replies).toBe(0);
    });

    it('an old edit waiting for approval is carried as pending', async () => {
      const e = await editedEntry();
      await stagePending(e, C, '11:00');
      const entry = dayIn(await history(), MON).entries[0]!;
      expect(entry.pending).toMatchObject({
        fromTime: '09:00',
        toTime: '11:00',
        description: 'edited',
        order: null,
      });
      expect(entry.toTime).toBe('10:00');
    });
  });

  describe('Day Log — History period and access', () => {
    it('a future month or date is refused; an earlier month is whole', async () => {
      for (const q of [{ month: '2040-02' }, { date: '2040-01-11' }]) {
        await expect(history(q)).rejects.toBeInstanceOf(ValidationError);
        await expect(history(q)).rejects.toThrow('has not come yet');
      }
      expect((await history({ month: '2039-12' })).days).toHaveLength(31);
      // A leap February, from March.
      expect(
        (await history({ month: '2040-02' }, superAdmin(), at('2040-03-15', '12:00'))).days,
      ).toHaveLength(29);
    });

    it('a date that is not on the calendar is refused', async () => {
      for (const date of ['2026-02-31', '2039-13-01', '2039-04-31']) {
        await expect(history({ date })).rejects.toBeInstanceOf(ValidationError);
      }
    });

    it('an unknown person or one of another company is not found', async () => {
      await expect(
        service.getPersonHistory(
          { userId: '00000000-0000-4000-8000-000000000000', month: MONTH },
          superAdmin(),
          C,
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
      const otherCompany = asAccess(
        { ...fx.admin, companyId: '00000000-0000-4000-8000-000000000001' },
        { fullAccess: true },
        'manager',
      );
      await expect(history({ month: MONTH }, otherCompany)).rejects.toThrow('Day Log not found');
    });

    it('only a Super Admin: Auditor, Dept Admin, team mate and the person are refused', async () => {
      const row = await service.addTeamMate(
        { userId: fx.admin.id, mateId: fx.ownerBase.id },
        superAdmin(),
      );
      try {
        // The mate can see the day, but not its History.
        await add(MON, C);
        const seen = await service.getPersonDay(
          { userId: fx.ownerBase.id, date: MON },
          plainAdmin(),
          C,
        );
        expect(seen.entries).toHaveLength(1);
        await expect(history({ month: MONTH }, plainAdmin())).rejects.toThrow(
          'Only a Super Admin can see Day Log History',
        );
      } finally {
        await service.removeTeamMate(row.id, superAdmin());
      }
      for (const as of [auditor(), sameDeptAdmin(), owner()]) {
        await expect(history({ month: MONTH }, as)).rejects.toBeInstanceOf(AuthorizationError);
      }
    });

    it('canSeeHistory: true only for a Super Admin', async () => {
      expect((await service.getAccess(superAdmin())).canSeeHistory).toBe(true);
      expect((await service.getAccess(fx.admin)).canSeeHistory).toBe(true);
      for (const as of [auditor(), sameDeptAdmin(), plainAdmin(), owner()]) {
        expect((await service.getAccess(as)).canSeeHistory).toBe(false);
      }
    });
  });
}

export function personHistoryRouteCases(): void {
  describe('Day Log — History route and query (ADR-278)', () => {
    const id = '00000000-0000-4000-8000-000000000000';
    const url = (q: string): string => `/day-logs/person-history?${q}`;

    it('the query takes exactly one of month and date', () => {
      expect(dayLogHistoryQuerySchema.safeParse({ userId: id, month: '2026-10' }).success).toBe(
        true,
      );
      expect(dayLogHistoryQuerySchema.safeParse({ userId: id, date: '2026-10-14' }).success).toBe(
        true,
      );
      expect(dayLogHistoryQuerySchema.safeParse({ userId: id }).success).toBe(false);
      expect(
        dayLogHistoryQuerySchema.safeParse({ userId: id, month: '2026-10', date: '2026-10-14' })
          .success,
      ).toBe(false);
      expect(dayLogHistoryQuerySchema.safeParse({ userId: id, month: '2026-13' }).success).toBe(
        false,
      );
      expect(dayLogHistoryQuerySchema.safeParse({ userId: 'x', month: '2026-10' }).success).toBe(
        false,
      );
    });

    it('answers 200 for a Super Admin, 403 for a normal user, 401 with no login, 400 on a bad period', async () => {
      const q = `userId=${fx.ownerBase.id}&month=2026-10`;
      const asSuper = await appAs(fx.admin);
      const ok = await asSuper.inject({ method: 'GET', url: url(q) });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().userId).toBe(fx.ownerBase.id);
      const both = await asSuper.inject({ method: 'GET', url: url(`${q}&date=2026-10-01`) });
      expect(both.statusCode).toBe(400);
      const halfTyped = await asSuper.inject({
        method: 'GET',
        url: url(`userId=${fx.ownerBase.id}&date=0002-10-14`),
      });
      expect(halfTyped.statusCode).toBe(400);
      await asSuper.close();

      const asOwner = await appAs(owner());
      expect((await asOwner.inject({ method: 'GET', url: url(q) })).statusCode).toBe(403);
      await asOwner.close();

      const noLogin = await appAs(null);
      expect((await noLogin.inject({ method: 'GET', url: url(q) })).statusCode).toBe(401);
      await noLogin.close();
    });
  });
}
