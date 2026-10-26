// Day Log — one person's days over a From–To range (the person page). Three
// reads for the whole range (headers, lines, holidays), no per-day query.

import {
  DAY_LOG_RULES,
  type DayLogStatus,
  type PersonDayLogQuery,
  type PersonDayLogResponse,
  type PersonDayRow,
  isWorkingDay,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { ValidationError } from '../../lib/errors';
import { addDays, dayDiff } from '../dashboard/personal/util';
import { deptLabelOf, loadViewer, requireVisibleUser } from './access';
import { type DayLine, holidaysBetween, loadLinesFor } from './day';
import { summaryOf } from './detail';
import { type DayLogClock, istClock } from './rules';
import { requireCompany } from './writes';

export async function getPerson(
  query: PersonDayLogQuery,
  user: AuthContext,
  clock: DayLogClock = istClock(), // tests only — routes never pass it
): Promise<PersonDayLogResponse> {
  const companyId = requireCompany(user);
  const v = await loadViewer(user); // before the tx (ADR-229)
  const from = query.from;
  const to = query.to > clock.today ? clock.today : query.to;
  if (from > to) throw new ValidationError('From must be on or before To (and not after today)');
  if (dayDiff(from, to) + 1 > DAY_LOG_RULES.maxRangeDays) {
    throw new ValidationError(`Pick at most ${DAY_LOG_RULES.maxRangeDays} days`);
  }

  return withUserContext(user, async (tx) => {
    const target = await requireVisibleUser(tx, companyId, v, query.userId);
    const headers = (await tx.execute(sql`
      SELECT dr.id::text AS id, to_char(dr.report_date, 'YYYY-MM-DD') AS d, dr.day_status AS status
      FROM public.daily_reports dr
      WHERE dr.company_id = ${companyId}::uuid AND dr.user_id = ${target.id}::uuid
        AND dr.report_date BETWEEN ${from}::date AND ${to}::date AND dr.deleted_at IS NULL
    `)) as unknown as Array<{ id: string; d: string; status: DayLogStatus }>;
    const byDate = new Map(headers.map((h) => [h.d, h]));
    const linesBy = new Map<string, DayLine[]>();
    for (const l of await loadLinesFor(
      tx,
      companyId,
      headers.map((h) => h.id),
    )) {
      const arr = linesBy.get(l.reportId) ?? [];
      arr.push(l);
      linesBy.set(l.reportId, arr);
    }
    const holDates = [...(await holidaysBetween(tx, companyId, from, to)).keys()];

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
  });
}
