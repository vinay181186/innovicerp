// Day Log — Team Day Logs: one row per person the viewer may see, for one
// date. Three reads (people, headers, lines) for the whole team, no
// per-person query.

import {
  type DayLogStatus,
  type TeamDayLogQuery,
  type TeamDayLogResponse,
  type TeamDayLogRow,
  isWorkingDay,
  minToHhmm,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import { canSeeTeam, canSeeUser, deptLabelOf, loadViewer, sharedTeamDepts } from './access';
import { type DayLine, holidaysBetween, iso, loadLinesFor } from './day';
import { summaryOf } from './detail';
import { type DayLogClock, currentOf, istClock, latestWorkOf } from './rules';
import { requireCompany } from './writes';

export async function getTeam(
  query: TeamDayLogQuery,
  user: AuthContext,
  clock: DayLogClock = istClock(), // tests only — routes never pass it
): Promise<TeamDayLogResponse> {
  const companyId = requireCompany(user);
  const v = await loadViewer(user); // before the tx (ADR-229)
  if (!canSeeTeam(v)) {
    throw new AuthorizationError("Only a Department Admin can see the team's Day Logs");
  }
  const date = query.date ?? clock.today;
  const isToday = date === clock.today;
  const nowMin = isToday ? clock.nowMin : undefined;
  const wide = v.isSuper || v.auditor;

  return withUserContext(user, async (tx) => {
    // Team by RIGHTS: everyone (Super Admin / Auditor), else people holding
    // L2+ in a department the viewer is L5 of (canSeeUser — one rule).
    const all = (await tx.execute(sql`
      SELECT u.id::text AS id, COALESCE(u.full_name, u.email) AS name, ua.main_dept,
             COALESCE(ua.departments, '{}'::jsonb) AS departments
      FROM public.users u
      LEFT JOIN public.user_access ua
        ON ua.user_id = u.id AND ua.company_id = ${companyId}::uuid AND ua.deleted_at IS NULL
      WHERE u.company_id = ${companyId}::uuid AND u.deleted_at IS NULL AND u.is_active
      ORDER BY COALESCE(u.full_name, u.email)
    `)) as unknown as Array<{
      id: string;
      name: string;
      main_dept: string | null;
      departments: Record<string, unknown>;
    }>;
    const people = all
      .filter((p) => wide || canSeeUser(v, p))
      .map((p) => ({ ...p, team: wide ? [] : sharedTeamDepts(v, p.departments) }));
    const ids = people.map((p) => p.id);

    const headers = ids.length
      ? ((await tx.execute(sql`
          SELECT dr.id::text AS id, dr.user_id::text AS user_id, dr.day_status AS status,
                 dr.submitted_at
          FROM public.daily_reports dr
          WHERE dr.company_id = ${companyId}::uuid AND dr.report_date = ${date}::date
            AND dr.deleted_at IS NULL AND dr.user_id = ANY(${sql.param(ids)}::uuid[])
        `)) as unknown as Array<{
          id: string;
          user_id: string;
          status: DayLogStatus;
          submitted_at: Date | string | null;
        }>)
      : [];
    const byUser = new Map(headers.map((h) => [h.user_id, h]));
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

    const hol = await holidaysBetween(tx, companyId, date, date);
    const workingDay = isWorkingDay(date, [...hol.keys()]);
    const rows: TeamDayLogRow[] = people.map((p) => {
      const h = byUser.get(p.id);
      const lines = h ? (linesBy.get(h.id) ?? []) : [];
      const status: DayLogStatus = h?.status ?? 'open';
      const s = summaryOf(lines, nowMin, workingDay, status);
      const now = currentOf(status, lines, iso(h?.submitted_at), isToday, s.lastStop, nowMin);
      return {
        userId: p.id,
        userName: p.name,
        // The department that puts them on this admin's team, else their own.
        deptLabel: deptLabelOf(p.team[0] ?? p.main_dept),
        dayLogId: h?.id ?? null,
        status,
        currentStatus: now.status,
        currentText: now.text,
        runningSince: now.since,
        latestWork: latestWorkOf(lines),
        firstStart: s.firstStart,
        lastStop: s.lastStop,
        workMin: s.workMin,
        breakMin: s.breakMin,
        leaveMin: s.leaveMin,
        entryCount: s.entryCount,
        lateCount: s.lateCount,
        lateInMin: s.lateInMin,
      };
    });

    return { date, today: clock.today, nowTime: minToHhmm(clock.nowMin), workingDay, rows };
  });
}
