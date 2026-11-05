// Day Log — Pending Entries (owner 2026-11-05): a working day before today on
// which an eligible person has entered nothing (rules.ts isPendingDate), read in
// ONE statement for everybody, no per-person query. SQL returns only the MISSING
// dates, so the result depends on the blanks, not on the days logged. Holidays are
// then dropped through the shared isWorkingDay, so the working-day rule stays in
// one place. Team Day Logs, person-day and the bell use the helpers below.
//
// Eligible: active, not deleted, Day Log page open, not a Super Admin (owner
// rule), and not an Auditor (never writes, so could never clear a pending day).
// Start: the later of companies.day_log_pending_from (0240) and the login's IST
// creation date (access.ts PENDING_START_SQL).
// Done: a live line that day (part-filled counts), or an old day_status 'leave'.

import {
  DAY_LOG_RULES,
  type DayLogMyPending,
  type DayLogPendingCalendar,
  type DayLogPendingResponse,
  type DayLogPendingRow,
  isWorkingDay,
} from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import type { AuthContext } from '../../db/with-user-context';
import { AuthorizationError, NotFoundError } from '../../lib/errors';
import {
  PENDING_START_SQL,
  type PersonAccess,
  accessJson,
  deptLabelOf,
  isSuperPerson,
  personAccessJson,
  personOpensDayLog,
  resolveAccess,
  viewerOf,
} from './access';
import { holidaysJson } from './day';
import { type DayLogClock, isPendingDate, istClock } from './rules';
import { requireCompany } from './writes';

export type PendingPerson = PersonAccess & {
  id: string;
  name: string;
  mainDept: string | null;
};

/** The company's first pending date. */
const companyFrom = (companyId: string): SQL =>
  sql`(SELECT c.day_log_pending_from FROM public.companies c WHERE c.id = ${companyId}::uuid)`;

export const isPendingEligible = (p: PersonAccess): boolean =>
  personOpensDayLog(p) && !isSuperPerson(p) && p.auditor !== true;

/** One date: Team Day Logs and person-day's "Not entered". */
export const isNotEntered = (
  p: PersonAccess,
  date: string,
  done: boolean,
  holidays: readonly string[],
  clock: DayLogClock,
): boolean =>
  isPendingEligible(p) && isPendingDate(date, p.pendingStart, clock.today, done, holidays);

/**
 * The columns behind pendingOf: people (active, not deleted), missing (user id →
 * the dates from their start up to yesterday, on a working weekday, with no entry
 * and no old Leave), holidays. `only` narrows to one person. Scalar sub-selects,
 * so they ride inside a bigger statement. EXTRACT(DOW) and getUTCDay agree: 0 = Sunday.
 */
export function pendingColumns(companyId: string, clock: DayLogClock, only?: string): SQL {
  const onlyPerson = only ? sql`AND u.id = ${only}::uuid` : sql``;
  const weekdays = sql.param([...DAY_LOG_RULES.workingWeekdays]);
  return sql`
    (SELECT COALESCE(json_agg(json_build_object(
              'id', u.id::text, 'name', COALESCE(u.full_name, u.email), 'mainDept', ua.main_dept,
              'departments', COALESCE(ua.departments, '{}'::jsonb), ${personAccessJson})), '[]'::json)
     FROM public.users u
     LEFT JOIN public.user_access ua
       ON ua.user_id = u.id AND ua.company_id = ${companyId}::uuid AND ua.deleted_at IS NULL
     WHERE u.company_id = ${companyId}::uuid AND u.deleted_at IS NULL AND u.is_active ${onlyPerson}
    ) AS people,
    (SELECT COALESCE(json_object_agg(x.user_id, x.dates), '{}'::json) FROM (
       SELECT u.id::text AS user_id, json_agg(to_char(g.d, 'YYYY-MM-DD') ORDER BY g.d) AS dates
       FROM public.users u
       CROSS JOIN LATERAL generate_series(${PENDING_START_SQL}::timestamp,
         (${clock.today}::date - 1)::timestamp, interval '1 day') AS g(d)
       WHERE u.company_id = ${companyId}::uuid AND u.deleted_at IS NULL AND u.is_active ${onlyPerson}
         AND EXTRACT(DOW FROM g.d)::int = ANY(${weekdays}::int[])
         AND NOT EXISTS (
           SELECT 1 FROM public.daily_reports dr
           WHERE dr.company_id = ${companyId}::uuid AND dr.user_id = u.id
             AND dr.report_date = g.d::date AND dr.deleted_at IS NULL
             AND (dr.day_status = 'leave' OR EXISTS (
                   SELECT 1 FROM public.daily_report_lines l
                   WHERE l.daily_report_id = dr.id AND l.deleted_at IS NULL)))
       GROUP BY u.id) x
    ) AS missing,
    ${holidaysJson(companyId, companyFrom(companyId), clock.today)} AS holidays`;
}

/** pendingColumns → every eligible person with their pending dates, oldest first
 *  (none = caught up). */
export function pendingOf(
  r: Record<string, unknown> | undefined,
): Array<{ person: PendingPerson; dates: string[] }> {
  const missing = (r?.['missing'] ?? {}) as Record<string, string[]>;
  const holidays = Object.keys((r?.['holidays'] ?? {}) as Record<string, string>);
  return ((r?.['people'] ?? []) as PendingPerson[]).filter(isPendingEligible).map((person) => ({
    person,
    dates: (missing[person.id] ?? []).filter((d) => isWorkingDay(d, holidays)),
  }));
}

/** GET /day-logs/pending/mine — the banner: [] for anyone not eligible, never a
 *  refusal (it runs on every page). */
export async function getMyPending(
  user: AuthContext,
  clock: DayLogClock = istClock(), // tests only — routes never pass it
): Promise<DayLogMyPending> {
  if (!user.companyId) return { dates: [] };
  const rows = (await db.execute(
    sql`SELECT ${pendingColumns(user.companyId, clock, user.id)}`,
  )) as unknown as Array<Record<string, unknown>>;
  return { dates: pendingOf(rows[0])[0]?.dates ?? [] };
}

const DAY_MS = 86_400_000;

/** GET /day-logs/pending — Super Admin only; one row per person + date, oldest
 *  first. ONE statement: the access, the pending facts, each blank day's reply
 *  counts and its open task. */
export async function getPending(
  user: AuthContext,
  clock: DayLogClock = istClock(), // tests only — routes never pass it
): Promise<DayLogPendingResponse> {
  const companyId = requireCompany(user);
  const window = sql`dr.report_date >= ${companyFrom(companyId)} AND dr.report_date < ${clock.today}::date`;
  const [r] = (await db.execute(sql`
    SELECT ${accessJson(user.id, companyId)} AS access,
      ${pendingColumns(companyId, clock)},
      (SELECT COALESCE(json_agg(q), '[]'::json) FROM (
         SELECT dr.user_id::text AS user_id, to_char(dr.report_date, 'YYYY-MM-DD') AS date,
                count(*)::int AS replies, (count(*) FILTER (WHERE rp.seen_at IS NULL))::int AS unseen
         FROM public.daily_report_day_replies rp
         JOIN public.daily_reports dr ON dr.id = rp.daily_report_id AND dr.deleted_at IS NULL
         WHERE rp.company_id = ${companyId}::uuid AND rp.deleted_at IS NULL AND ${window}
         GROUP BY dr.user_id, dr.report_date) q) AS replies,
      (SELECT COALESCE(json_agg(q), '[]'::json) FROM (
         SELECT dr.user_id::text AS user_id, to_char(dr.report_date, 'YYYY-MM-DD') AS date, t.code
         FROM public.tasks t
         JOIN public.daily_reports dr ON dr.id::text = t.linked_ref_id AND dr.deleted_at IS NULL
         WHERE t.company_id = ${companyId}::uuid AND t.linked_ref_type = 'day_log_date'
           AND t.deleted_at IS NULL AND t.status IN ('todo', 'in_progress') AND ${window}) q) AS tasks
  `)) as unknown as Array<Record<string, unknown>>;
  const v = viewerOf(user, await resolveAccess(user, r?.['access']));
  if (!v.isSuper) throw new AuthorizationError('Only a Super Admin can see Pending Entries');

  const keyOf = (userId: string, date: string): string => `${userId}|${date}`;
  type Keyed = { user_id: string; date: string };
  const replies = new Map(
    ((r?.['replies'] ?? []) as Array<Keyed & { replies: number; unseen: number }>).map((x) => [
      keyOf(x.user_id, x.date),
      x,
    ]),
  );
  const codes = new Map(
    ((r?.['tasks'] ?? []) as Array<Keyed & { code: string }>).map((x) => [
      keyOf(x.user_id, x.date),
      x.code,
    ]),
  );
  const rows: DayLogPendingRow[] = pendingOf(r).flatMap(({ person, dates }) =>
    dates.map((date) => {
      const k = keyOf(person.id, date);
      return {
        userId: person.id,
        userName: person.name,
        deptLabel: deptLabelOf(person.mainDept),
        date,
        daysPending: Math.round((Date.parse(clock.today) - Date.parse(date)) / DAY_MS),
        taskCode: codes.get(k) ?? null,
        replyCount: replies.get(k)?.replies ?? 0,
        unseenCount: replies.get(k)?.unseen ?? 0,
      };
    }),
  );
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.userName.localeCompare(b.userName));
  return { today: clock.today, rows };
}

/** GET /day-logs/pending/:id/calendar — Super Admin only; ONE statement. Red comes
 *  from pendingOf, so it can never differ from the person's banner or the list.
 *  Green reads from the first of the person's first month; an old Leave day is
 *  neither green nor red. */
export async function getPendingCalendar(
  userId: string,
  user: AuthContext,
  clock: DayLogClock = istClock(), // tests only — routes never pass it
): Promise<DayLogPendingCalendar> {
  const companyId = requireCompany(user);
  const firstDay = sql`date_trunc('month', (
      SELECT ${PENDING_START_SQL} FROM public.users u WHERE u.id = ${userId}::uuid))::date`;
  const days = sql`dr.company_id = ${companyId}::uuid AND dr.user_id = ${userId}::uuid
    AND dr.deleted_at IS NULL AND dr.report_date <= ${clock.today}::date
    AND dr.report_date >= ${firstDay}`;
  const [r] = (await db.execute(sql`
    SELECT ${accessJson(user.id, companyId)} AS access,
      ${pendingColumns(companyId, clock, userId)},
      ${holidaysJson(companyId, firstDay, clock.today)} AS calendar_holidays,
      (SELECT COALESCE(json_agg(to_char(dr.report_date, 'YYYY-MM-DD') ORDER BY dr.report_date), '[]'::json)
       FROM public.daily_reports dr
       WHERE ${days} AND EXISTS (
         SELECT 1 FROM public.daily_report_lines l
         WHERE l.daily_report_id = dr.id AND l.deleted_at IS NULL)) AS filled,
      (SELECT COALESCE(json_agg(to_char(dr.report_date, 'YYYY-MM-DD') ORDER BY dr.report_date), '[]'::json)
       FROM public.daily_reports dr
       WHERE ${days} AND (
         EXISTS (SELECT 1 FROM public.daily_report_day_replies rp
                 WHERE rp.daily_report_id = dr.id AND rp.deleted_at IS NULL)
         OR EXISTS (SELECT 1 FROM public.daily_report_lines l
                    JOIN public.daily_report_line_replies lr ON lr.line_id = l.id AND lr.deleted_at IS NULL
                    WHERE l.daily_report_id = dr.id AND l.deleted_at IS NULL))) AS replied
  `)) as unknown as Array<Record<string, unknown>>;
  const v = viewerOf(user, await resolveAccess(user, r?.['access']));
  if (!v.isSuper) throw new AuthorizationError('Only a Super Admin can see Pending Entries');
  const one = pendingOf(r)[0];
  if (!one) throw new NotFoundError('This person does not keep a Day Log');
  return {
    userId: one.person.id,
    userName: one.person.name,
    deptLabel: deptLabelOf(one.person.mainDept),
    today: clock.today,
    firstMonth: one.person.pendingStart.slice(0, 7),
    filled: (r?.['filled'] ?? []) as string[],
    pending: one.dates,
    replied: (r?.['replied'] ?? []) as string[],
    holidays: Object.keys((r?.['calendar_holidays'] ?? {}) as Record<string, string>),
  };
}
