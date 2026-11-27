// Day Log — Personal Leave (owner 2026-11-27), TEST database. Registered by
// service.test.ts (leaveCases()) so it shares that file's fixture. Runs in
// January 2040 with the company's day_log_pending_from set there (restored
// after), like pending-cases.ts; wipeOwnerDays clears 2040 before each case.
import { dayLogLeaveInputSchema } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { AuthorizationError, ValidationError } from '../../lib/errors';
import { asAccess } from '../../lib/test-access';
import * as service from './service';
import { type DayLogClock } from './rules';
import { add, batch, edit, fx, owner, ownerAsSuper, superAdmin } from './test-fixture';

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
  service.setLeave({ from, to, kind: 'full', reason }, as, THU_CLOCK);

/** Part 2 (0268) — a Half Day on one date with its own leave time. */
const half = (date: string, fromTime: string, toTime: string, c: DayLogClock = THU_CLOCK) =>
  service.setLeave(
    { from: date, to: date, kind: 'half', fromTime, toTime, reason: 'Doctor' },
    owner(),
    c,
  );

/** The owner as an Auditor (never writes). */
const ownerAsAuditor = () =>
  asAccess(fx.ownerBase, { auditor: true, departments: { tasks: 'L1' } }, 'manager');

/** The owner's live header on `date`: status, kind, leave time. */
async function headerOf(date: string) {
  const rows = (await db.execute(sql`
    SELECT day_status::text AS s, leave_kind AS k,
      to_char(leave_from, 'HH24:MI') AS f, to_char(leave_to, 'HH24:MI') AS t
    FROM public.daily_reports
    WHERE user_id = ${fx.ownerBase.id}::uuid AND report_date = ${date}::date AND deleted_at IS NULL
  `)) as unknown as Array<{ s: string; k: string; f: string | null; t: string | null }>;
  return rows;
}

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
      expect(list.days).toEqual([
        { date: TUE, reason: 'Family function', kind: 'full', fromTime: null, toTime: null },
      ]);
      expect(list.earliest).toBe(MON);
      expect(list.latest).toBe('2040-04-04');
    });

    it('a range skips Sunday and a company holiday (no header for them)', async () => {
      const h = await service.addHoliday({ date: TUE2, name: 'Leave test holiday' }, superAdmin());
      try {
        const r = await service.setLeave(
          { from: FRI, to: TUE2, kind: 'full', reason: 'Trip' },
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

    it('part 2: a Super Admin may set their own leave (pending stays as it was)', async () => {
      expect(await leave(TUE, TUE, 'x', ownerAsSuper())).toEqual({ set: [TUE], skipped: [] });
      expect(await statusOf(TUE)).toBe('leave');
      expect((await service.getAccess(owner())).canSetLeave).toBe(true);
      expect((await service.getAccess(ownerAsSuper())).canSetLeave).toBe(true);
    });

    it('part 2: an Auditor is refused; canSetLeave false', async () => {
      await expect(leave(TUE, TUE, 'x', ownerAsAuditor())).rejects.toBeInstanceOf(
        AuthorizationError,
      );
      expect((await service.getAccess(ownerAsAuditor())).canSetLeave).toBe(false);
      expect(await statusOf(TUE)).toBeNull();
    });

    it('Team Day Logs today: Now = Personal Leave with the reason', async () => {
      const today = clock(WED);
      await service.setLeave(
        { from: WED, to: WED, kind: 'full', reason: 'Doctor' },
        owner(),
        today,
      );
      const row = (await service.getTeam({ date: WED }, superAdmin(), today)).rows.find(
        (r) => r.userId === fx.ownerBase.id,
      )!;
      expect(row).toMatchObject({
        status: 'leave',
        currentStatus: 'leave',
        currentText: 'Doctor',
        leaveKind: 'full',
        leaveFrom: null,
        leaveTo: null,
      });
    });

    // ── Part 2 (owner 2026-11-27, 0268): Full Day / Half Day ──────────────────

    it('Half Day: refused when an entry is inside the leave time; allowed beside it', async () => {
      await entry(TUE); // 09:00–10:00
      await expect(half(TUE, '09:30', '13:00')).rejects.toThrow(
        '03-01-2040 has an entry 09:00 AM – 10:00 AM inside the leave time — Personal Leave not set',
      );
      expect(await statusOf(TUE)).toBe('open');
      expect(await half(TUE, '13:00', '18:00')).toEqual({ set: [TUE], skipped: [] });
      expect(await headerOf(TUE)).toEqual([{ s: 'leave', k: 'half', f: '13:00', t: '18:00' }]);
      // Already on leave (either kind) = skipped.
      expect(await half(TUE, '13:00', '18:00')).toEqual({ set: [], skipped: [TUE] });
      expect(await leave(TUE)).toEqual({ set: [], skipped: [TUE] });
    });

    it('Half Day today: an Open entry counts up to now', async () => {
      const today = clock(WED, 15 * 60); // 03:00 PM
      await db.execute(sql`
        WITH d AS (
          INSERT INTO public.daily_reports (company_id, user_id, report_date, created_by, updated_by)
          VALUES (${fx.ownerBase.companyId}::uuid, ${fx.ownerBase.id}::uuid, ${WED}::date,
                  ${fx.ownerBase.id}::uuid, ${fx.ownerBase.id}::uuid)
          RETURNING id, company_id)
        INSERT INTO public.daily_report_lines
          (company_id, daily_report_id, line_no, description, kind, from_time, to_time, status,
           hours, created_by, updated_by)
        SELECT d.company_id, d.id, 1, 'running', 'work', '13:30'::time, NULL, 'completed', 0,
               ${fx.ownerBase.id}::uuid, ${fx.ownerBase.id}::uuid FROM d`);
      await expect(half(WED, '14:00', '18:00', today)).rejects.toThrow(
        '04-01-2040 has an entry 01:30 PM – now inside the leave time',
      );
    });

    it('Half Day: an entry inside the leave time is refused (add, sheet, edit); outside allowed', async () => {
      await half(WED, '13:00', '18:00');
      const msg = 'Overlaps Personal Leave 01:00 PM – 06:00 PM — rows cannot share time';
      await expect(add(WED, THU_CLOCK, { startTime: '14:00', stopTime: '15:00' })).rejects.toThrow(
        msg,
      );
      await expect(add(WED, THU_CLOCK, { startTime: '12:30', stopTime: '13:01' })).rejects.toThrow(
        msg,
      );
      await expect(
        batch(WED, THU_CLOCK, [
          { startTime: '09:00', stopTime: '10:00' },
          { startTime: '17:00', stopTime: '18:30' },
        ]),
      ).rejects.toThrow(`Row 2: ${msg}`);
      const d = await add(WED, THU_CLOCK, { startTime: '09:00', stopTime: '13:00' }); // ends at 13:00
      const e = d.entries[0]!;
      await expect(edit(e, THU_CLOCK, { stopTime: '14:00' })).rejects.toThrow(msg);
      const after = await add(WED, THU_CLOCK, { startTime: '18:00', stopTime: '19:00' });
      expect(after.entries.map((x) => [x.fromTime, x.toTime])).toEqual([
        ['09:00', '13:00'],
        ['18:00', '19:00'],
      ]);
      expect(after).toMatchObject({
        status: 'leave',
        leaveKind: 'half',
        leaveFrom: '13:00',
        leaveTo: '18:00',
      });
      // The leave time is not "unlogged".
      expect(after.summary.unloggedMin).toBe(0);
    });

    it('Half Day with no entry stays pending; an entry clears it (option A)', async () => {
      await half(MON, '13:00', '18:00');
      expect((await mine()).dates).toEqual([MON, TUE, WED]);
      await add(MON, THU_CLOCK, { startTime: '09:00', stopTime: '10:00' });
      expect((await mine()).dates).toEqual([TUE, WED]);
    });

    it('Full → remove → Half on the same date: one header row; remove a Half with entries', async () => {
      await leave(TUE);
      await service.removeLeave(TUE, owner());
      expect(await headerOf(TUE)).toEqual([{ s: 'open', k: 'full', f: null, t: null }]);
      await half(TUE, '13:00', '18:00');
      expect(await headerOf(TUE)).toEqual([{ s: 'leave', k: 'half', f: '13:00', t: '18:00' }]);
      const list = await service.getMyLeave(owner(), THU_CLOCK);
      expect(list.days).toEqual([
        { date: TUE, reason: 'Doctor', kind: 'half', fromTime: '13:00', toTime: '18:00' },
      ]);
      await entry(TUE); // 09:00–10:00, outside the leave time
      expect(await service.removeLeave(TUE, owner())).toEqual({ ok: true });
      expect(await headerOf(TUE)).toEqual([{ s: 'open', k: 'full', f: null, t: null }]);
    });

    it('Team today on a Half Day: normal Now, leave time on the row', async () => {
      const today = clock(WED);
      await half(WED, '13:00', '18:00', today);
      const row = (await service.getTeam({ date: WED }, superAdmin(), today)).rows.find(
        (r) => r.userId === fx.ownerBase.id,
      )!;
      expect(row).toMatchObject({
        status: 'leave',
        currentStatus: 'not_started',
        leaveKind: 'half',
        leaveFrom: '13:00',
        leaveTo: '18:00',
      });
    });

    it('History: 2 Full Days + 1 Half Day = 2.5 leave days', async () => {
      await leave(MON, TUE);
      await half(WED, '13:00', '18:00');
      const h = await service.getPersonHistory(
        { userId: fx.ownerBase.id, from: MON, to: WED },
        superAdmin(),
        THU_CLOCK,
      );
      expect(h.totals.leaveDays).toBe(2.5);
      expect(h.days.map((d) => [d.state, d.leaveKind])).toEqual([
        ['leave', 'full'],
        ['leave', 'full'],
        ['not_entered', 'half'],
      ]);
      expect(h.days[2]).toMatchObject({ leaveFrom: '13:00', leaveTo: '18:00' });
      expect(h.hasContent).toBe(true);
    });

    it('an old leave row (before 0268) reads as Full Day', async () => {
      await db.execute(sql`
        INSERT INTO public.daily_reports
          (company_id, user_id, report_date, day_status, leave_reason, created_by, updated_by)
        VALUES (${fx.ownerBase.companyId}::uuid, ${fx.ownerBase.id}::uuid, ${TUE}::date, 'leave',
                'Old', ${fx.ownerBase.id}::uuid, ${fx.ownerBase.id}::uuid)`);
      const list = await service.getMyLeave(owner(), THU_CLOCK);
      expect(list.days).toEqual([
        { date: TUE, reason: 'Old', kind: 'full', fromTime: null, toTime: null },
      ]);
      await expect(entry(TUE)).rejects.toThrow('is marked Personal Leave — remove the leave first');
      expect((await mine()).dates).toEqual([MON, WED]);
    });

    it('a Half Day over a range is refused (schema and service)', async () => {
      const input = {
        from: MON,
        to: TUE,
        kind: 'half' as const,
        fromTime: '13:00',
        toTime: '18:00',
        reason: 'x',
      };
      expect(dayLogLeaveInputSchema.safeParse(input).success).toBe(false);
      await expect(service.setLeave(input, owner(), THU_CLOCK)).rejects.toBeInstanceOf(
        ValidationError,
      );
      expect(await statusOf(MON)).toBeNull();
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
