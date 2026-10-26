// Day Log service — against the TEST database. Owner = a real non-admin user
// with a main department; manager = the seed admin's id given an L5 (or
// other-department L5) matrix via asAccess. Time is logged only by the timer
// (owner 2026-10-26), so every write runs on a fixed clock (`at`) on days in
// 2001 (never real data); those days and today are hard-deleted for the owner
// before each test and after the file. The owner's break template is saved
// first and put back at the end.
import { type DayLogDetail, type MyBreaksResponse } from '@innovic/shared';
import { and, eq, isNotNull, ne, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { userAccess, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { asAccess } from '../../lib/test-access';
import { type DayLogClock, istClock } from './rules';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const MON = '2001-01-01';
const TUE = '2001-01-02';
const WED = '2001-01-03';

let admin: AuthContext;
let ownerBase: AuthContext;
let ownerDept: string;
let otherDept: string;
let savedBreaks: MyBreaksResponse | null = null;

const owner = (): AuthContext =>
  asAccess(ownerBase, { departments: { [ownerDept]: 'L1' } }, 'viewer');
const sameDeptAdmin = (): AuthContext =>
  asAccess(admin, { departments: { [ownerDept]: 'L5' } }, 'manager');
const otherDeptAdmin = (): AuthContext =>
  asAccess(admin, { departments: { [otherDept]: 'L5' } }, 'manager');

/** A fixed clock: `date` is "today", `hhmm` is now. */
const at = (date: string, hhmm: string): DayLogClock => {
  const [h, m] = hhmm.split(':');
  return { today: date, nowMin: Number(h) * 60 + Number(m) };
};

async function wipeOwnerDays(): Promise<void> {
  const { today } = istClock();
  await db.execute(sql`
    DELETE FROM public.daily_reports
    WHERE user_id = ${ownerBase.id}::uuid
      AND (report_date < '2002-01-01'::date OR report_date = ${today}::date)
  `);
}

const start = (clock: DayLogClock, description = 'test work') =>
  service.startTimer({ description }, owner(), clock);
const stop = (clock: DayLogClock, endTime?: string) =>
  service.stopTimer(
    endTime ? { status: 'completed', endTime } : { status: 'completed' },
    owner(),
    clock,
  );
const work = (d: DayLogDetail) =>
  d.entries.filter((e) => e.kind === 'work').map((e) => [e.fromTime, e.toTime]);

/** A whole working day: 09:00–13:00, Lunch, 13:30–18:00. */
async function fullDay(date: string): Promise<void> {
  await start(at(date, '18:00')); // fills 09:00–13:00, runs from 13:30
  await stop(at(date, '18:00'));
}

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };

  const { today } = istClock();
  const others = await db
    .select({ user: users, mainDept: userAccess.mainDept })
    .from(users)
    .innerJoin(userAccess, eq(userAccess.userId, users.id))
    .where(
      and(
        eq(users.companyId, u.companyId),
        ne(users.id, u.id),
        eq(users.isActive, true),
        isNotNull(userAccess.mainDept),
        sql`${userAccess.deletedAt} IS NULL`,
        sql`${users.deletedAt} IS NULL`,
        // Stop looks for the running timer on ANY day — skip a user who has
        // a real one on a day these tests do not wipe.
        sql`NOT EXISTS (
          SELECT 1 FROM public.daily_report_lines l
          JOIN public.daily_reports dr ON dr.id = l.daily_report_id AND dr.deleted_at IS NULL
          WHERE dr.user_id = ${users.id} AND l.kind = 'work' AND l.to_time IS NULL
            AND l.deleted_at IS NULL AND dr.report_date >= '2002-01-01'::date
            AND dr.report_date <> ${today}::date)`,
      ),
    )
    .limit(1);
  const o = others[0];
  if (!o || !o.mainDept) throw new Error('TEST needs one non-admin user with a main department');
  ownerBase = {
    id: o.user.id,
    email: o.user.email,
    companyId: o.user.companyId,
    role: o.user.role,
    isActive: o.user.isActive,
  };
  ownerDept = o.mainDept;
  otherDept = ownerDept === 'purchase' ? 'store' : 'purchase';

  savedBreaks = await service.getMyBreaks(owner());
  await wipeOwnerDays();
  await service.saveMyBreaks(
    { breaks: [{ name: 'Lunch', fromTime: '13:00', toTime: '13:30' }] },
    owner(),
  );
});

beforeEach(async () => {
  await wipeOwnerDays();
});

afterAll(async () => {
  if (!ownerBase) return;
  await wipeOwnerDays();
  if (savedBreaks) await service.saveMyBreaks({ breaks: savedBreaks.breaks }, owner());
});

describe('Day Log — Start', () => {
  it('Start at 09:00, then new work at 10:00 closes the first at 10:00 (Completed)', async () => {
    const d1 = await start(at(MON, '09:00'), 'first');
    expect(work(d1)).toEqual([['09:00', null]]);
    const d2 = await start(at(MON, '10:00'), 'second');
    expect(work(d2)).toEqual([
      ['09:00', '10:00'],
      ['10:00', null],
    ]);
    const first = d2.entries.find((e) => e.description === 'first')!;
    expect(first.status).toBe('completed');
    expect(first.minutes).toBe(60);
  });

  it('a first Start late in the morning begins at 09:00 (no gap)', async () => {
    const d = await start(at(MON, '10:15'));
    expect(work(d)).toEqual([['09:00', null]]);
  });

  it('a gap that contains Lunch: work fills nextFrom → 13:00 and runs from 13:30', async () => {
    await start(at(MON, '09:00'), 'morning');
    await stop(at(MON, '11:00'));
    const d = await start(at(MON, '14:00'), 'afternoon');
    expect(work(d)).toEqual([
      ['09:00', '11:00'],
      ['11:00', '13:00'],
      ['13:30', null],
    ]);
    const filled = d.entries.find((e) => e.fromTime === '11:00')!;
    expect(filled.description).toBe('afternoon');
    expect(filled.status).toBe('completed');
    expect(filled.stopNote).toBe('stopped at 13:00 for your Lunch break');
  });

  it('a running timer that crossed Lunch is closed at 13:00, the new work runs from 13:30', async () => {
    await start(at(MON, '12:00'));
    const d = await start(at(MON, '14:00'), 'next');
    expect(work(d)).toEqual([
      ['09:00', '13:00'],
      ['13:30', null],
    ]);
    expect(d.entries.find((e) => e.fromTime === '09:00')!.stopNote).toMatch(/Lunch break/);
  });

  it('Start inside a break is refused', async () => {
    await expect(start(at(MON, '13:10'))).rejects.toThrow(/You are on Lunch until 13:30/);
    const day = await service.getDay({ date: MON }, owner());
    expect(work(day)).toEqual([]);
  });

  it('two Starts at once — exactly one running, no overlapping entries', async () => {
    await Promise.allSettled([start(at(MON, '10:00'), 'a'), start(at(MON, '10:00'), 'b')]);
    const day = await service.getDay({ date: MON }, owner());
    const w = day.entries.filter((e) => e.kind === 'work');
    expect(w.filter((e) => e.toTime === null)).toHaveLength(1);
    const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    for (let i = 1; i < w.length; i += 1) {
      expect(toMin(w[i]!.fromTime)).toBeGreaterThanOrEqual(toMin(w[i - 1]!.toTime!));
    }
  });
});

describe('Day Log — Stop', () => {
  it('Finished at earlier than now closes there', async () => {
    await start(at(MON, '09:00'));
    const d = await stop(at(MON, '11:00'), '10:30');
    expect(work(d)).toEqual([['09:00', '10:30']]);
    expect(d.summary.nextFrom).toBe('10:30');
  });

  it('Finished at later than now is refused', async () => {
    await start(at(MON, '09:00'));
    await expect(stop(at(MON, '11:00'), '11:30')).rejects.toBeInstanceOf(ValidationError);
  });

  it('Finished at over a break is refused, naming the break', async () => {
    await start(at(MON, '09:00'));
    await expect(stop(at(MON, '14:00'), '13:20')).rejects.toThrow(
      /Lunch 13:00–13:30 is inside — finish at 13:00 or earlier/,
    );
    await expect(stop(at(MON, '14:00'), '14:00')).rejects.toThrow(/finish at 13:00 or earlier/);
  });

  it('no Finished at: now, cut at the next break', async () => {
    await start(at(MON, '09:00'));
    const d = await stop(at(MON, '14:00'));
    expect(work(d)).toEqual([['09:00', '13:00']]);
    expect(d.summary.nextFrom).toBe('13:30');
  });
});

describe('Day Log — submit', () => {
  it('submit with time missing is refused', async () => {
    await start(at(WED, '09:00'));
    await stop(at(WED, '11:00'));
    await expect(service.submitDay({ date: WED }, owner())).rejects.toBeInstanceOf(ValidationError);
  });

  it('two submits at once — one wins, the other is a 409', async () => {
    await fullDay(WED);
    const res = await Promise.allSettled([
      service.submitDay({ date: WED }, owner()),
      service.submitDay({ date: WED }, owner()),
    ]);
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = res.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(ConflictError);
  });

  it('reopen: L5 of the same department may; L5 of another department gets not found', async () => {
    await fullDay(WED);
    await service.submitDay({ date: WED }, owner());
    await expect(
      service.reopenDay(
        { userId: ownerBase.id, date: WED, reason: 'other dept' },
        otherDeptAdmin(),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    const d = await service.reopenDay(
      { userId: ownerBase.id, date: WED, reason: 'fix a line' },
      sameDeptAdmin(),
    );
    expect(d.status).toBe('open');
    expect(d.reopenReason).toBe('fix a line');
    await expect(
      service.reopenDay({ userId: ownerBase.id, date: WED, reason: 'again' }, sameDeptAdmin()),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('an L5 cannot reopen their own day', async () => {
    await expect(
      service.reopenDay({ userId: admin.id, date: WED, reason: 'mine' }, sameDeptAdmin()),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('an unfinished earlier working day blocks the next one (D3)', async () => {
    await start(at(MON, '09:00'));
    await stop(at(MON, '10:00'));
    await expect(start(at(TUE, '09:00'))).rejects.toThrow(/01-01-2001 is not finished/);
  });
});

describe('Day Log — Team current status', () => {
  const row = async (date: string, clock: DayLogClock) => {
    const t = await service.getTeam({ date }, sameDeptAdmin(), clock);
    expect(t.nowTime).toBe(
      `${String(Math.floor(clock.nowMin / 60)).padStart(2, '0')}:${String(clock.nowMin % 60).padStart(2, '0')}`,
    );
    const r = t.rows.find((x) => x.userId === ownerBase.id);
    if (!r) throw new Error('owner missing from Team Day Logs');
    return r;
  };

  it('not_started, then break from the template, before anything is logged', async () => {
    expect((await row(MON, at(MON, '10:00'))).currentStatus).toBe('not_started');
    const b = await row(MON, at(MON, '13:10'));
    expect(b.currentStatus).toBe('break');
    expect(b.currentText).toBe('Lunch until 13:30');
  });

  it('working → idle → break', async () => {
    await start(at(MON, '09:00'), 'GRN entry');
    const w = await row(MON, at(MON, '10:00'));
    expect(w.currentStatus).toBe('working');
    expect(w.currentText).toBe('GRN entry · since 09:00');
    expect(w.runningSince).toBe('09:00');

    await stop(at(MON, '10:30'));
    const i = await row(MON, at(MON, '11:00'));
    expect(i.currentStatus).toBe('idle');
    expect(i.currentText).toBe('since 10:30');
    expect(i.runningSince).toBeNull();
    // Seen on a later day, the same day is just not submitted.
    expect((await row(MON, at(TUE, '11:00'))).currentText).toBe('Not submitted');

    expect((await row(MON, at(MON, '13:10'))).currentStatus).toBe('break');
  });

  it('submitted shows the submitted time', async () => {
    await fullDay(WED);
    await service.submitDay({ date: WED }, owner());
    const s = await row(WED, at(WED, '18:30'));
    expect(s.currentStatus).toBe('submitted');
    expect(s.currentText).toMatch(/^\d\d:\d\d$/);
  });
});
