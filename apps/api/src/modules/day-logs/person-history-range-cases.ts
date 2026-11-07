// Day Log — History (ADR-278), TEST database: the From-To range, its refusals,
// access and the route. Registered by service.test.ts; split from
// person-history-cases.ts, whose January 2040 clock and helpers it shares. Rows are
// written only in 2040 and after, which wipeOwnerDays clears before each test.
import { DAY_LOG_HISTORY_MAX_DAYS, dayLogHistoryQuerySchema } from '@innovic/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import type { AuthContext } from '../../db/with-user-context';
import { AuthorizationError, NotFoundError, ValidationError } from '../../lib/errors';
import { asAccess } from '../../lib/test-access';
import { errorHandlerPlugin } from '../../plugins/error-handler';
import { C, JAN, MON, TODAY, TUE, WED, dayIn, history, lineAt, one } from './person-history-cases';
import { dayLogsRoutes } from './routes';
import * as service from './service';
import { add, at, fx, owner, sameDeptAdmin, superAdmin, work } from './test-fixture';

async function appAs(user: AuthContext | null): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    if (user) req.user = user;
  });
  await app.register(errorHandlerPlugin);
  await app.register(dayLogsRoutes);
  return app;
}

/** The seed admin's id as a plain viewer: no Full Access, no L5 anywhere. */
const plainAdmin = (): AuthContext =>
  asAccess(fx.admin, { departments: { [fx.otherDept]: 'L1', tasks: 'L1' } }, 'manager');
const auditor = (): AuthContext =>
  asAccess(fx.admin, { auditor: true, departments: { tasks: 'L1' } }, 'manager');

const total = (h: Awaited<ReturnType<typeof history>>, of: 'workMin' | 'entryCount') =>
  h.days.reduce((n, d) => n + d[of], 0);

export function personHistoryRangeCases(): void {
  describe('Day Log — History range', () => {
    it('a range crossing two months returns every date in order, and totals are the sum of the days', async () => {
      // 30-Jan-2040 is a Monday; today is Monday 06-Feb.
      const clock = at('2040-02-06', '12:00');
      await add('2040-01-31', clock, { startTime: '09:00', stopTime: '10:00' });
      await add('2040-02-02', clock, { startTime: '09:00', stopTime: '11:00' });

      const h = await history({ from: '2040-01-30', to: '2040-02-03' }, superAdmin(), clock);
      expect([h.from, h.to]).toEqual(['2040-01-30', '2040-02-03']);
      expect(h.days.map((d) => d.date)).toEqual([
        '2040-01-30',
        '2040-01-31',
        '2040-02-01',
        '2040-02-02',
        '2040-02-03',
      ]);
      expect(h.totals).toMatchObject({
        workingDays: 5,
        filledDays: 2,
        notEntered: 3,
        entries: 2,
        workMin: 180,
      });
      expect(h.totals.workMin).toBe(total(h, 'workMin'));
      expect(h.totals.entries).toBe(total(h, 'entryCount'));
    });

    it('a range crossing the year runs from 20-12 to 10-01', async () => {
      const clock = at('2041-01-10', '12:00');
      await add('2040-12-31', clock, { startTime: '09:00', stopTime: '10:00' });
      await add('2041-01-02', clock, { startTime: '09:00', stopTime: '09:30' });

      const h = await history({ from: '2040-12-20', to: '2041-01-10' }, superAdmin(), clock);
      expect(h.days.map((d) => d.date)).toEqual([
        ...Array.from({ length: 12 }, (_, i) => `2040-12-${i + 20}`),
        ...Array.from({ length: 10 }, (_, i) => `2041-01-${String(i + 1).padStart(2, '0')}`),
      ]);
      expect(dayIn(h, '2040-12-31').workMin).toBe(60);
      expect(dayIn(h, '2041-01-02').workMin).toBe(30);
      expect(h.days[h.days.length - 1]!.state).toBe('today');
      expect(h.totals).toMatchObject({ filledDays: 2, entries: 2, workMin: 90 });
    });

    it('avgDailyWorkMin is total / filled days, ignores Not entered dates and rounds to the minute', async () => {
      await add(MON, C, { startTime: '09:00', stopTime: '10:00' });
      await add(TUE, C, { startTime: '09:00', stopTime: '10:00' });
      await add(WED, C, { startTime: '09:00', stopTime: '10:05' });

      const { totals } = await history(JAN);
      // 185 / 3 = 61.67. Dividing by the working days as well would give far less.
      expect(totals).toMatchObject({ workMin: 185, filledDays: 3, avgDailyWorkMin: 62 });
      expect(totals.notEntered).toBeGreaterThan(0);
    });

    it('avgDailyWorkMin is 0 with no filled day', async () => {
      // Thursday to Saturday, all Not entered.
      const { totals } = await history({ from: '2040-01-05', to: '2040-01-07' });
      expect(totals).toMatchObject({
        filledDays: 0,
        notEntered: 3,
        workMin: 0,
        avgDailyWorkMin: 0,
      });
    });

    it('day.editedEntries counts entries, not edits; totals.editedEntries is their sum', async () => {
      await add(MON, C, { startTime: '11:00', stopTime: '12:00' });
      const mon = await add(MON, C, { startTime: '09:00', stopTime: '10:00' });
      const once = await work(lineAt(mon, '09:00'), C, 'edit one');
      await work(lineAt(once, '09:00'), C, 'edit two');
      const tue = await add(TUE, C, { startTime: '09:00', stopTime: '10:00' });
      await work(lineAt(tue, '09:00'), C, 'edit one');
      await add(WED, C, { startTime: '09:00', stopTime: '10:00' });

      const h = await history(JAN);
      const facts = (date: string) => {
        const d = dayIn(h, date);
        return [d.editedEntries, d.edits, d.entryCount];
      };
      expect(facts(MON)).toEqual([1, 2, 2]);
      expect(facts(TUE)).toEqual([1, 1, 1]);
      expect(facts(WED)).toEqual([0, 0, 1]);
      expect(h.totals).toMatchObject({ editedEntries: 2, edits: 3 });
      expect(h.totals.editedEntries).toBe(h.days.reduce((n, d) => n + d.editedEntries, 0));
    });
  });

  describe('Day Log — History period and access', () => {
    it('a To Date after today is refused; an earlier whole month and today are read', async () => {
      for (const q of [
        { from: '2040-02-01', to: '2040-02-29' },
        one('2040-01-11'),
        { from: TODAY, to: '2040-01-11' },
      ]) {
        await expect(history(q)).rejects.toBeInstanceOf(ValidationError);
        await expect(history(q)).rejects.toThrow('A date after today has no Day Log');
      }
      expect((await history({ from: '2039-12-01', to: '2039-12-31' })).days).toHaveLength(31);
      expect((await history(one(TODAY))).days).toHaveLength(1);
      // A leap February, from March.
      expect(
        (
          await history(
            { from: '2040-02-01', to: '2040-02-29' },
            superAdmin(),
            at('2040-03-15', '12:00'),
          )
        ).days,
      ).toHaveLength(29);
    });

    it('a From Date after the To Date is refused', async () => {
      const q = { from: WED, to: MON };
      await expect(history(q)).rejects.toBeInstanceOf(ValidationError);
      await expect(history(q)).rejects.toThrow('From Date cannot be after To Date');
    });

    it('93 days is refused; exactly 92 days is accepted', async () => {
      // 92 days up to 31-Mar-2040, a leap year: 31-Dec + 31 + 29 + 31.
      const clock = at('2040-03-31', '12:00');
      const to = '2040-03-31';
      await expect(history({ from: '2039-12-30', to }, superAdmin(), clock)).rejects.toThrow(
        `Pick ${DAY_LOG_HISTORY_MAX_DAYS} days or less`,
      );
      const h = await history({ from: '2039-12-31', to }, superAdmin(), clock);
      expect(h.days).toHaveLength(DAY_LOG_HISTORY_MAX_DAYS);
      expect([h.days[0]!.date, h.days[h.days.length - 1]!.date]).toEqual(['2039-12-31', to]);
    });

    it('a date that is not on the calendar is refused', async () => {
      for (const date of ['2026-02-31', '2039-13-01', '2039-04-31']) {
        await expect(history(one(date))).rejects.toBeInstanceOf(ValidationError);
        await expect(history(one(date))).rejects.toThrow('Pick a real From Date');
      }
      await expect(history({ from: MON, to: '2040-01-32' })).rejects.toThrow('Pick a real To Date');
    });

    it('a year before 2000 is refused', async () => {
      for (const q of [one('0002-10-14'), { from: '1999-12-31', to: '2000-01-01' }]) {
        await expect(history(q)).rejects.toBeInstanceOf(ValidationError);
        await expect(history(q)).rejects.toThrow('Pick a date from the year 2000 on');
      }
    });

    it('an unknown person or one of another company is not found', async () => {
      await expect(
        service.getPersonHistory(
          { userId: '00000000-0000-4000-8000-000000000000', ...JAN },
          superAdmin(),
          C,
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
      const otherCompany = asAccess(
        { ...fx.admin, companyId: '00000000-0000-4000-8000-000000000001' },
        { fullAccess: true },
        'manager',
      );
      await expect(history(JAN, otherCompany)).rejects.toThrow('Day Log not found');
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
        await expect(history(JAN, plainAdmin())).rejects.toThrow(
          'Only a Super Admin can see Day Log History',
        );
      } finally {
        await service.removeTeamMate(row.id, superAdmin());
      }
      for (const as of [auditor(), sameDeptAdmin(), owner()]) {
        await expect(history(JAN, as)).rejects.toBeInstanceOf(AuthorizationError);
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

    it('the query needs both From Date and To Date; a bad format is refused', () => {
      const ok = (q: Record<string, string>) => dayLogHistoryQuerySchema.safeParse(q).success;
      expect(ok({ userId: id, from: '2026-10-01', to: '2026-10-31' })).toBe(true);
      expect(ok({ userId: id, from: '2026-10-14', to: '2026-10-14' })).toBe(true);
      expect(ok({ userId: id })).toBe(false);
      expect(ok({ userId: id, from: '2026-10-01' })).toBe(false);
      expect(ok({ userId: id, to: '2026-10-31' })).toBe(false);
      // The old month and date forms.
      expect(ok({ userId: id, month: '2026-10' })).toBe(false);
      expect(ok({ userId: id, date: '2026-10-14' })).toBe(false);
      expect(ok({ userId: id, from: '01-10-2026', to: '2026-10-31' })).toBe(false);
      expect(ok({ userId: id, from: '2026-10-01', to: '2026-10' })).toBe(false);
      expect(ok({ userId: 'x', from: '2026-10-01', to: '2026-10-31' })).toBe(false);
    });

    it('answers 200 for a Super Admin, 403 for a normal user, 401 with no login, 400 on a bad period', async () => {
      const who = `userId=${fx.ownerBase.id}`;
      const q = `${who}&from=2026-10-01&to=2026-10-31`;
      const asSuper = await appAs(fx.admin);
      const ok = await asSuper.inject({ method: 'GET', url: url(q) });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().userId).toBe(fx.ownerBase.id);
      const halfTyped = await asSuper.inject({
        method: 'GET',
        url: url(`${who}&from=0002-10-14&to=0002-10-14`),
      });
      expect(halfTyped.statusCode).toBe(400);
      const backwards = await asSuper.inject({
        method: 'GET',
        url: url(`${who}&from=2026-10-31&to=2026-10-01`),
      });
      expect(backwards.statusCode).toBe(400);
      const noTo = await asSuper.inject({ method: 'GET', url: url(`${who}&from=2026-10-01`) });
      expect(noTo.statusCode).toBe(400);
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
