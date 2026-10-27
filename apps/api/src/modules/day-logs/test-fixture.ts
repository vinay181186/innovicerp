// Day Log DB-test fixture (TEST database only — imported by service.test.ts,
// never by app code). Owner = a real non-admin user with a main department;
// manager = the seed admin's id given an L5 matrix via asAccess. Every write
// runs on a fixed clock (`at`) on days in 2001 (never real data); those days
// and today are hard-deleted for the owner before each test and after the file.
import {
  type AddDayLogEntryInput,
  type DayLogDetail,
  type DayLogEntry,
  type UpdateDayLogEntryInput,
} from '@innovic/shared';
import { and, eq, isNotNull, ne, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { userAccess, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { asAccess } from '../../lib/test-access';
import { type DayLogClock, istClock } from './rules';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
export const MON = '2001-01-01';
export const TUE = '2001-01-02';
export const WED = '2001-01-03';

/** Filled by setupFixture() in beforeAll. */
export const fx = {
  admin: undefined as unknown as AuthContext,
  ownerBase: undefined as unknown as AuthContext,
  ownerDept: '',
  openSo: { id: '', code: '' },
};

export const owner = (): AuthContext =>
  asAccess(fx.ownerBase, { departments: { [fx.ownerDept]: 'L1' } }, 'viewer');
export const sameDeptAdmin = (): AuthContext =>
  asAccess(fx.admin, { departments: { [fx.ownerDept]: 'L5' } }, 'manager');

/** A fixed clock: `date` is "today", `hhmm` is now. */
export const at = (date: string, hhmm: string): DayLogClock => {
  const [h, m] = hhmm.split(':');
  return { today: date, nowMin: Number(h) * 60 + Number(m) };
};

export async function wipeOwnerDays(): Promise<void> {
  const { today } = istClock();
  await db.execute(sql`
    DELETE FROM public.daily_reports
    WHERE user_id = ${fx.ownerBase.id}::uuid
      AND (report_date < '2002-01-01'::date OR report_date = ${today}::date)
  `);
}

type Fields = Partial<Omit<AddDayLogEntryInput, 'date'>>;
/** Add one entry; a remark is sent unless `f` says otherwise (compulsory on
 *  a closed Work / Others entry). */
export const add = (date: string, clock: DayLogClock, f: Fields) =>
  service.addEntry(
    {
      date,
      kind: 'work',
      description: 'test work',
      startTime: '09:00',
      remarks: 'done',
      ...f,
    } as AddDayLogEntryInput,
    owner(),
    clock,
  );

/** Edit an entry as loaded (§20.4 updatedAt), changing only `f`. */
export const edit = (e: DayLogEntry, clock: DayLogClock, f: Partial<UpdateDayLogEntryInput>) =>
  service.updateEntry(
    e.id,
    {
      kind: e.kind,
      description: e.description,
      startTime: e.fromTime,
      stopTime: e.toTime,
      orderType: e.order?.type ?? null,
      orderId: e.order?.id ?? null,
      remarks: e.remarks,
      updatedAt: e.updatedAt,
      ...f,
    } as UpdateDayLogEntryInput,
    owner(),
    clock,
  );
export const times = (d: DayLogDetail) => d.entries.map((e) => [e.kind, e.fromTime, e.toTime]);

/** A whole working day in two entries: 09:00–17:30 work, 17:30–18:00 break. */
export async function fullDay(date: string): Promise<void> {
  const c = at(date, '18:00');
  await add(date, c, { startTime: '09:00', stopTime: '17:30' });
  await add(date, c, { kind: 'break', description: 'Tea', startTime: '17:30', stopTime: '18:00' });
}

/** The owner's Team Day Logs row as a same-department L5 sees it. */
export async function teamRow(date: string, clock: DayLogClock) {
  const t = await service.getTeam({ date }, sameDeptAdmin(), clock);
  const r = t.rows.find((x) => x.userId === fx.ownerBase.id);
  if (!r) throw new Error('owner missing from Team Day Logs');
  return r;
}

/** Pick the owner / admin / an open SO on TEST, then wipe the owner's test days. */
export async function setupFixture(): Promise<void> {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing');
  fx.admin = {
    id: u.id,
    email: u.email,
    companyId: u.companyId,
    role: u.role,
    isActive: u.isActive,
  };

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
        // One Open entry per user across ALL days — skip a user who has a
        // real one on a day these tests do not wipe.
        sql`NOT EXISTS (
          SELECT 1 FROM public.daily_report_lines l
          JOIN public.daily_reports dr ON dr.id = l.daily_report_id AND dr.deleted_at IS NULL
          WHERE dr.user_id = ${users.id} AND l.to_time IS NULL AND l.from_time IS NOT NULL
            AND l.deleted_at IS NULL AND dr.report_date >= '2002-01-01'::date
            AND dr.report_date <> ${today}::date)`,
      ),
    )
    .limit(1);
  const o = others[0];
  if (!o || !o.mainDept) throw new Error('TEST needs one non-admin user with a main department');
  fx.ownerBase = {
    id: o.user.id,
    email: o.user.email,
    companyId: o.user.companyId,
    role: o.user.role,
    isActive: o.user.isActive,
  };
  fx.ownerDept = o.mainDept;

  const so = (await db.execute(sql`
    SELECT id::text AS id, code FROM public.sales_orders
    WHERE company_id = ${u.companyId}::uuid AND deleted_at IS NULL
      AND status NOT IN ('cancelled', 'closed')
    ORDER BY created_at DESC LIMIT 1
  `)) as unknown as Array<{ id: string; code: string }>;
  if (!so[0]) throw new Error('TEST needs one open Sales Order');
  fx.openSo = so[0];
  await wipeOwnerDays();
}
