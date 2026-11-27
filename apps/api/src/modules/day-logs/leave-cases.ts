// Day Log — Personal Leave (owner 2026-11-27), TEST database. Registered by
// service.test.ts (leaveCases()) so it shares that file's fixture. Runs in
// January 2040 with the company's day_log_pending_from set there (restored
// after), like pending-cases.ts; wipeOwnerDays clears 2040 before each case.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { AuthorizationError, ValidationError } from '../../lib/errors';
import * as service from './service';
import { type DayLogClock } from './rules';
import { fx, owner, superAdmin } from './test-fixture';

// 02-Jan-2040 is a Monday; 07-Jan a Saturday; 08-Jan a Sunday.
const MON = '2040-01-02';
const TUE = '2040-01-03';
const WED = '2040-01-04';
const FRI = '2040-01-06';
const SAT = '2040-01-07';
const SUN = '2040-01-08';
const MON2 = '2040-01-09';
const TUE2 = '2040-01-10';
const clock = (today: string, nowMin = 12 * 60): DayLogClock => ({ today, nowMin });
const THU_CLOCK = clock('2040-01-05');

const leave = (from: string, to = from, reason = 'Family function', as = owner()) =>
  service.setLeave({ from, to, reason }, as, THU_CLOCK);

const entry = (date: string, c: DayLogClock = THU_CLOCK) =>
  service.addEntry(
    { date, kind: 'work', description: 'x', startTime: '09:00', stopTime: '10:00' },
    owner(),
    c,
  );

const mine = (c: DayLogClock = THU_CLOCK) => service.getMyPending(owner(), c);

async function statusOf(date: string): Promise<string | null> {
  const [r] = (await db.execute(sql`
    SELECT day_status::text AS s FROM public.daily_reports
    WHERE user_id = ${fx.ownerBase.id}::uuid AND report_date = ${date}::date AND deleted_at IS NULL
  `)) as unknown as Array<{ s: string }>;
  return r?.s ?? null;
}

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

export function leaveCases(): void {
  let companyFrom = '';
  beforeAll(async () => {
    companyFrom = await setCompanyFrom(MON);
  });
  afterAll(async () => {
    await setCompanyFrom(companyFrom);
  });

  describe('Day Log — Personal Leave', () => {
    it('one date: marked leave, listed in mine, not pending', async () => {
      expect((await mine()).dates).toEqual([MON, TUE, WED]);
      expect(await leave(TUE)).toEqual({ set: [TUE], skipped: [] });
      expect(await statusOf(TUE)).toBe('leave');
      expect((await mine()).dates).toEqual([MON, WED]);
      const list = await service.getMyLeave(owner(), THU_CLOCK);
      expect(list.days).toEqual([{ date: TUE, reason: 'Family function' }]);
      expect(list.earliest).toBe(MON);
      expect(list.latest).toBe('2040-04-04');
    });

    it('a range skips Sunday and a company holiday (no header for them)', async () => {
      const h = await service.addHoliday({ date: TUE2, name: 'Leave test holiday' }, superAdmin());
      try {
        const r = await service.setLeave(
          { from: FRI, to: TUE2, reason: 'Trip' },
          owner(),
          clock('2040-01-11'),
        );
        expect(r).toEqual({ set: [FRI, SAT, MON2], skipped: [SUN, TUE2] });
        expect(await statusOf(SUN)).toBeNull();
        expect(await statusOf(TUE2)).toBeNull();
      } finally {
        await service.deleteHoliday(h.id, superAdmin());
      }
    });

    it('a date with entries refuses the whole save', async () => {
      await entry(TUE);
      await expect(leave(MON, WED)).rejects.toThrow(
        '03-01-2040 already has entries — Personal Leave not set.',
      );
      expect(await statusOf(MON)).toBeNull(); // rolled back, header not left behind
      expect(await statusOf(TUE)).toBe('open');
      await entry(WED);
      await expect(leave(MON, WED)).rejects.toThrow(
        '03-01-2040, 04-01-2040 already have entries — Personal Leave not set.',
      );
    });

    it('a repeated save is a no-op', async () => {
      await leave(MON, TUE);
      expect(await leave(MON, TUE)).toEqual({ set: [], skipped: [MON, TUE] });
    });

    it('nothing to set: a Sunday alone, a range of non-working days', async () => {
      await expect(leave(SUN)).rejects.toThrow('08-01-2040 is not a working day — nothing to set');
      const h = await service.addHoliday({ date: MON2, name: 'Leave test holiday' }, superAdmin());
      try {
        await expect(leave(SUN, MON2)).rejects.toThrow(
          'No working days from 08-01-2040 to 09-01-2040 — nothing to set',
        );
      } finally {
        await service.deleteHoliday(h.id, superAdmin());
      }
    });

    it('future date up to today + 90 is allowed; beyond is refused', async () => {
      expect((await leave('2040-04-04')).set).toEqual(['2040-04-04']);
      await expect(leave('2040-04-05')).rejects.toThrow('too far ahead');
    });

    it('more than 60 days in one save is refused', async () => {
      await expect(leave(FRI, '2040-03-06')).rejects.toThrow('at most 60 days');
    });

    it('before the Day Log start is refused', async () => {
      await expect(leave('2040-01-01', MON)).rejects.toThrow('before your Day Log start');
    });

    it('an entry on a leave day is refused (single add and sheet batch)', async () => {
      await leave(WED);
      await expect(entry(WED)).rejects.toThrow(
        '04-01-2040 is marked Personal Leave — remove the leave first',
      );
      await expect(
        service.addEntries(
          {
            date: WED,
            rows: [{ description: 'x', startTime: '09:00', stopTime: '10:00' }],
          },
          owner(),
          THU_CLOCK,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('remove → pending again, entries allowed; remove twice is ok', async () => {
      await leave(TUE);
      expect(await service.removeLeave(TUE, owner())).toEqual({ ok: true });
      expect(await statusOf(TUE)).toBe('open');
      expect((await mine()).dates).toEqual([MON, TUE, WED]);
      expect(await service.removeLeave(TUE, owner())).toEqual({ ok: true });
      await entry(TUE);
    });

    it('a Super Admin may not set leave; canSetLeave follows the same rule', async () => {
      await expect(leave(MON, MON, 'x', superAdmin())).rejects.toBeInstanceOf(AuthorizationError);
      expect((await service.getAccess(owner())).canSetLeave).toBe(true);
      expect((await service.getAccess(superAdmin())).canSetLeave).toBe(false);
    });

    it('Team Day Logs today: Now = Personal Leave with the reason', async () => {
      const today = clock(WED);
      await service.setLeave({ from: WED, to: WED, reason: 'Doctor' }, owner(), today);
      const row = (await service.getTeam({ date: WED }, superAdmin(), today)).rows.find(
        (r) => r.userId === fx.ownerBase.id,
      )!;
      expect(row).toMatchObject({ status: 'leave', currentStatus: 'leave', currentText: 'Doctor' });
    });

    it('leave and an entry on the same day at once: exactly one wins (§20.3)', async () => {
      const [a, b] = await Promise.allSettled([leave(MON), entry(MON)]);
      const wins = [a, b].filter((x) => x.status === 'fulfilled').length;
      expect(wins).toBe(1);
      const s = await statusOf(MON);
      const [n] = (await db.execute(sql`
        SELECT count(*)::int AS n FROM public.daily_report_lines l
        JOIN public.daily_reports dr ON dr.id = l.daily_report_id
        WHERE dr.user_id = ${fx.ownerBase.id}::uuid AND dr.report_date = ${MON}::date
          AND l.deleted_at IS NULL
      `)) as unknown as Array<{ n: number }>;
      // Never both: a leave day with an entry.
      expect(s === 'leave' && n!.n > 0).toBe(false);
    });
  });
}
