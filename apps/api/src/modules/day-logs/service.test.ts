// Day Log service — against the TEST database (vitest.config.ts globalSetup).
// Owner = a real non-admin user with a main department; manager = the seed
// admin's id given an L5 (or other-department L5) matrix via asAccess.
// Days used are in 2001 (never real data) plus today for the timer; both are
// hard-deleted for the owner before each test and after the file. The owner's
// break template is saved first and put back at the end.
import { type MyBreaksResponse } from '@innovic/shared';
import { and, eq, isNotNull, ne, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { userAccess, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { asAccess } from '../../lib/test-access';
import { istClock } from './rules';
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

async function wipeOwnerDays(): Promise<void> {
  const { today } = istClock();
  await db.execute(sql`
    DELETE FROM public.daily_reports
    WHERE user_id = ${ownerBase.id}::uuid
      AND (report_date < '2002-01-01'::date OR report_date = ${today}::date)
  `);
}

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };

  const others = await db
    .select({ user: users, mainDept: userAccess.mainDept })
    .from(users)
    .innerJoin(userAccess, eq(userAccess.userId, users.id))
    .where(
      and(
        eq(users.companyId, u.companyId),
        ne(users.id, u.id),
        isNotNull(userAccess.mainDept),
        sql`${userAccess.deletedAt} IS NULL`,
        sql`${users.deletedAt} IS NULL`,
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

const add = (date: string, toTime: string, who: AuthContext = owner()) =>
  service.addEntry({ date, toTime, description: `test ${toTime}`, status: 'completed' }, who);

describe('Day Log — entries', () => {
  it('an L1 view-only owner adds entries in order; From is the server nextFrom', async () => {
    const d1 = await add(MON, '10:00');
    expect(d1.entries.filter((e) => e.kind === 'work').map((e) => [e.fromTime, e.toTime])).toEqual([
      ['09:00', '10:00'],
    ]);
    const d2 = await add(MON, '12:00');
    expect(d2.summary.nextFrom).toBe('12:00');
    expect(d2.entries.find((e) => e.kind === 'break')?.description).toBe('Lunch');
    expect(d2.summary.loggedMin).toBe(180);
  });

  it('a To that is not after nextFrom is refused', async () => {
    await add(MON, '10:00');
    await expect(add(MON, '10:00')).rejects.toBeInstanceOf(ValidationError);
  });

  it('a future day is refused', async () => {
    const tomorrow = new Date(Date.parse(`${istClock().today}T00:00:00Z`) + 86400000)
      .toISOString()
      .slice(0, 10);
    await expect(add(tomorrow, '10:00')).rejects.toBeInstanceOf(ValidationError);
  });

  it('an entry running over a break is refused, naming the break', async () => {
    await add(MON, '12:00');
    await expect(add(MON, '14:00')).rejects.toThrow(
      /Lunch 13:00–13:30 is inside this time — end at 13:00/,
    );
  });

  it('two adds of the same slot at once — exactly one wins', async () => {
    const res = await Promise.allSettled([add(TUE, '10:00'), add(TUE, '10:00')]);
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const day = await service.getDay({ date: TUE }, owner());
    expect(day.entries.filter((e) => e.kind === 'work')).toHaveLength(1);
  });
});

describe('Day Log — submit', () => {
  it('submit with time missing is refused', async () => {
    await add(WED, '11:00');
    await expect(service.submitDay({ date: WED }, owner())).rejects.toBeInstanceOf(ValidationError);
  });

  it('two submits at once — one wins, the other is a 409', async () => {
    await add(WED, '13:00');
    await add(WED, '18:00'); // From is pushed past Lunch to 13:30
    const res = await Promise.allSettled([
      service.submitDay({ date: WED }, owner()),
      service.submitDay({ date: WED }, owner()),
    ]);
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = res.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(ConflictError);
  });

  it('reopen: L5 of the same department may; L5 of another department gets not found', async () => {
    await add(WED, '13:00');
    await add(WED, '18:00');
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

  it('an unfinished earlier working day blocks the next one (D3)', async () => {
    await add(MON, '10:00');
    await expect(add(TUE, '10:00')).rejects.toThrow(/01-01-2001 is not finished/);
  });
});

describe('Day Log — timer', () => {
  it('two Starts at once — exactly one timer', async () => {
    await service.saveMyBreaks({ breaks: [] }, owner());
    try {
      const start = () =>
        service.startTimer({ description: 'timer test', includeGap: true }, owner());
      const res = await Promise.allSettled([start(), start()]);
      expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const day = await service.getDay({}, owner());
      expect(day.entries.filter((e) => e.kind === 'work' && e.toTime === null)).toHaveLength(1);
    } finally {
      await wipeOwnerDays();
      await service.saveMyBreaks(
        { breaks: [{ name: 'Lunch', fromTime: '13:00', toTime: '13:30' }] },
        owner(),
      );
    }
  });
});
