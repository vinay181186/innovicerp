// Day Log DB-test fixture (TEST database only — imported by service.test.ts,
// never by app code). Owner = a real non-admin user holding L2+ in their main
// department; approvers = the seed admin's id given an L5 matrix via asAccess.
// Every write runs on a fixed clock (`at`) on days in 2000/2001 (never real
// data); those days and today are hard-deleted for the owner before each test
// and after the file.
import {
  ACCESS_DEPTS,
  type DayLogDetail,
  type DayLogEntry,
  type DayLogSheetRow,
  type UpdateDayLogEntryInput,
  normalizeDeptsMap,
} from '@innovic/shared';
import { and, eq, isNotNull, ne, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { userAccess, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { asAccess } from '../../lib/test-access';
import { type DayLogClock, istClock } from './rules';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
export const SAT = '2001-01-06';
export const SUN = '2001-01-07';
export const MON = '2001-01-01';
export const TUE = '2001-01-02';
export const WED = '2001-01-03';
export const NEXT_MON = '2001-01-08';

/** Filled by setupFixture() in beforeAll. */
export const fx = {
  admin: undefined as unknown as AuthContext,
  ownerBase: undefined as unknown as AuthContext,
  ownerDept: '',
  /** A department where the owner holds no L2+ right. */
  otherDept: '',
  openSo: { id: '', code: '' },
};

export const owner = (): AuthContext =>
  asAccess(fx.ownerBase, { departments: { [fx.ownerDept]: 'L1' } }, 'viewer');
export const sameDeptAdmin = (): AuthContext =>
  asAccess(fx.admin, { departments: { [fx.ownerDept]: 'L5' } }, 'manager');
export const otherDeptAdmin = (): AuthContext =>
  asAccess(fx.admin, { departments: { [fx.otherDept]: 'L5' } }, 'manager');
/** The owner as if they were L5 of their own department. */
export const ownerAsAdmin = (): AuthContext =>
  asAccess(fx.ownerBase, { departments: { [fx.ownerDept]: 'L5' } }, 'manager');

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

type Fields = Partial<DayLogSheetRow>;
const fields = (f: Fields) => ({
  description: 'test work',
  startTime: '09:00',
  stopTime: '10:00',
  ...f,
});

/** Add one row. */
export const add = (date: string, clock: DayLogClock, f: Fields = {}) =>
  service.addEntry(
    { date, kind: 'work', ...fields(f) } as Parameters<typeof service.addEntry>[0],
    owner(),
    clock,
  );

/** Save rows as one sheet. */
export const batch = (date: string, clock: DayLogClock, rows: Fields[]) =>
  service.addEntries({ date, rows: rows.map(fields) }, owner(), clock);

/** Ask for an edit of a row as loaded (§20.4 updatedAt), changing only `f`. */
export const edit = (e: DayLogEntry, clock: DayLogClock, f: Partial<UpdateDayLogEntryInput>) =>
  service.updateEntry(
    e.id,
    {
      kind: 'work',
      description: e.description,
      startTime: e.fromTime,
      stopTime: e.toTime ?? '',
      orderType: e.order?.type ?? null,
      orderId: e.order?.id ?? null,
      updatedAt: e.updatedAt,
      ...f,
    } as UpdateDayLogEntryInput,
    owner(),
    clock,
  );
export const times = (d: DayLogDetail) => d.entries.map((e) => [e.fromTime, e.toTime]);

/** The owner's Team Day Logs row as a same-department L5 sees it. */
export async function teamRow(date: string, clock: DayLogClock) {
  const t = await service.getTeam({ date }, sameDeptAdmin(), clock);
  const r = t.rows.find((x) => x.userId === fx.ownerBase.id);
  if (!r) throw new Error('owner missing from Team Day Logs');
  return r;
}

const TEAM_TIERS = new Set(['L2', 'L3', 'L4', 'L5']);

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

  const others = await db
    .select({ user: users, mainDept: userAccess.mainDept, departments: userAccess.departments })
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
      ),
    );
  // The owner must be on their main department's team (L2+ there) and must
  // NOT be on some other department's team (the other-dept L5 case).
  const pick = others
    .map((o) => {
      const tiers = normalizeDeptsMap(
        (o.departments ?? {}) as Parameters<typeof normalizeDeptsMap>[0],
      );
      const other = ACCESS_DEPTS.find((d) => !TEAM_TIERS.has(String(tiers[d.key] ?? '')));
      return { o, ok: TEAM_TIERS.has(String(tiers[o.mainDept ?? ''] ?? '')), other };
    })
    .find((x) => x.ok && x.other);
  if (!pick || !pick.o.mainDept || !pick.other) {
    throw new Error('TEST needs one non-admin user with L2+ in their main department');
  }
  const o = pick.o;
  fx.ownerBase = {
    id: o.user.id,
    email: o.user.email,
    companyId: o.user.companyId,
    role: o.user.role,
    isActive: o.user.isActive,
  };
  fx.ownerDept = o.mainDept!;
  fx.otherDept = pick.other.key;

  const so = (await db.execute(sql`
    SELECT id::text AS id, code FROM public.sales_orders
    WHERE company_id = ${u.companyId}::uuid AND deleted_at IS NULL AND status = 'open'
    ORDER BY created_at DESC LIMIT 1
  `)) as unknown as Array<{ id: string; code: string }>;
  if (!so[0]) throw new Error('TEST needs one open Sales Order');
  fx.openSo = so[0];
  await wipeOwnerDays();
}
