// Day Log — one person's days over a From–To range (the person page). ONE
// statement for the whole range (access, person, headers, lines, holidays),
// no per-day query.

import {
  DAY_LOG_RULES,
  type DayLogStatus,
  type PersonDayLogQuery,
  type PersonDayLogResponse,
  type PersonDayRow,
  isWorkingDay,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { db } from '../../db/client';
import type { AuthContext } from '../../db/with-user-context';
import { ValidationError } from '../../lib/errors';
import { addDays, dayDiff } from '../dashboard/personal/util';
import {
  accessJson,
  dayUserJson,
  deptLabelOf,
  resolveAccess,
  toDayUser,
  viewerOf,
  visibleUser,
} from './access';
import { holidaysJson, linesByReport, linesJson, toHolidays, toLines } from './day';
import { summaryOf } from './detail';
import { type DayLogClock, istClock } from './rules';
import { requireCompany } from './writes';

export async function getPerson(
  query: PersonDayLogQuery,
  user: AuthContext,
  clock: DayLogClock = istClock(), // tests only — routes never pass it
): Promise<PersonDayLogResponse> {
  const companyId = requireCompany(user);
  const from = query.from;
  const to = query.to > clock.today ? clock.today : query.to;
  if (from > to) throw new ValidationError('From must be on or before To (and not after today)');
  if (dayDiff(from, to) + 1 > DAY_LOG_RULES.maxRangeDays) {
    throw new ValidationError(`Pick at most ${DAY_LOG_RULES.maxRangeDays} days`);
  }

  // ONE statement: the viewer's access, the person, the range's headers,
  // their lines and the holidays.
  const inRange = sql`dr.company_id = ${companyId}::uuid AND dr.user_id = ${query.userId}::uuid
    AND dr.report_date BETWEEN ${from}::date AND ${to}::date AND dr.deleted_at IS NULL`;
  const [r] = (await db.execute(sql`
    SELECT ${accessJson(user.id, companyId)} AS access,
      ${dayUserJson(companyId, query.userId)} AS target,
      (SELECT COALESCE(json_agg(json_build_object(
                'id', dr.id::text, 'd', to_char(dr.report_date, 'YYYY-MM-DD'),
                'status', dr.day_status)), '[]'::json)
       FROM public.daily_reports dr WHERE ${inRange}) AS headers,
      ${linesJson(companyId, inRange)} AS lines,
      ${holidaysJson(companyId, from, to)} AS holidays
  `)) as unknown as Array<Record<string, unknown>>;
  const v = viewerOf(user, await resolveAccess(user, r?.['access']));
  const target = visibleUser(v, toDayUser(r?.['target']));
  const headers = (r?.['headers'] ?? []) as Array<{ id: string; d: string; status: DayLogStatus }>;
  const byDate = new Map(headers.map((h) => [h.d, h]));
  const linesBy = linesByReport(toLines(r?.['lines']));
  const holDates = [...toHolidays(r?.['holidays']).keys()];

  const days: PersonDayRow[] = [];
  const totals = {
    daysLogged: 0,
    workMin: 0,
    avgWorkMin: 0,
    breakMin: 0,
    leaveMin: 0,
    lateCount: 0,
  };
  for (let d = to; d >= from; d = addDays(d, -1)) {
    const workingDay = isWorkingDay(d, holDates);
    const h = byDate.get(d);
    if (!workingDay && !h) continue;
    const lines = h ? (linesBy.get(h.id) ?? []) : [];
    const s = summaryOf(
      lines,
      d === clock.today ? clock.nowMin : undefined,
      workingDay,
      h?.status ?? 'open',
    );
    const orderCodes = [
      ...new Set(lines.filter((l) => l.kind === 'work' && l.order).map((l) => l.order!.code)),
    ];
    days.push({
      date: d,
      workingDay,
      status: h?.status ?? null,
      firstStart: s.firstStart,
      lastStop: s.lastStop,
      workMin: s.workMin,
      breakMin: s.breakMin,
      leaveMin: s.leaveMin,
      entryCount: s.entryCount,
      lateCount: s.lateCount,
      lateInMin: s.lateInMin,
      orderCodes,
    });
    if (s.entryCount > 0) totals.daysLogged += 1;
    totals.workMin += s.workMin;
    totals.breakMin += s.breakMin;
    totals.leaveMin += s.leaveMin;
    totals.lateCount += s.lateCount;
  }
  totals.avgWorkMin = totals.daysLogged ? Math.round(totals.workMin / totals.daysLogged) : 0;

  return {
    userId: target.id,
    userName: target.name,
    deptLabel: deptLabelOf(target.mainDept),
    from,
    to,
    today: clock.today,
    days,
    totals,
  };
}
