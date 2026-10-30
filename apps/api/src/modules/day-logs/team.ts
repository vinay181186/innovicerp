// Day Log — Team Day Logs: one row per person the viewer may see, for one
// date. ONE statement (people, headers, lines, holiday, access) for the whole
// team, no per-person query.

import {
  type DayLogStatus,
  type TeamDayLogQuery,
  type TeamDayLogResponse,
  type TeamDayLogRow,
  isWorkingDay,
  minToHhmm,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { db } from '../../db/client';
import type { AuthContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import {
  accessJson,
  canSeeTeam,
  canSeeUser,
  deptLabelOf,
  matesJson,
  type PersonAccess,
  personAccessJson,
  personOpensDayLog,
  resolveAccess,
  sharedTeamDepts,
  viewerOf,
} from './access';
import { holidaysJson, linesByReport, linesJson, toHolidays, toLines, ts } from './day';
import { summaryOf } from './detail';
import { type DayLogClock, currentOf, istClock, latestWorkOf } from './rules';
import { requireCompany } from './writes';

export async function getTeam(
  query: TeamDayLogQuery,
  user: AuthContext,
  clock: DayLogClock = istClock(), // tests only — routes never pass it
): Promise<TeamDayLogResponse> {
  const companyId = requireCompany(user);
  const date = query.date ?? clock.today;
  const isToday = date === clock.today;
  const nowMin = isToday ? clock.nowMin : undefined;

  // ONE statement: the viewer's access, the people, the day's headers, their
  // lines and the holiday — judged in memory.
  const [r] = (await db.execute(sql`
    SELECT ${accessJson(user.id, companyId)} AS access,
      ${matesJson(user.id, companyId)} AS mates,
      (SELECT COALESCE(json_agg(json_build_object(
                'id', u.id::text, 'name', COALESCE(u.full_name, u.email), 'main_dept', ua.main_dept,
                'departments', COALESCE(ua.departments, '{}'::jsonb), ${personAccessJson})
              ORDER BY COALESCE(u.full_name, u.email)), '[]'::json)
       FROM public.users u
       LEFT JOIN public.user_access ua
         ON ua.user_id = u.id AND ua.company_id = ${companyId}::uuid AND ua.deleted_at IS NULL
       WHERE u.company_id = ${companyId}::uuid AND u.deleted_at IS NULL AND u.is_active) AS people,
      (SELECT COALESCE(json_agg(json_build_object(
                'id', dr.id::text, 'user_id', dr.user_id::text, 'status', dr.day_status,
                'submitted_at', ${ts('dr.submitted_at')})), '[]'::json)
       FROM public.daily_reports dr
       WHERE dr.company_id = ${companyId}::uuid AND dr.report_date = ${date}::date
         AND dr.deleted_at IS NULL) AS headers,
      ${linesJson(
        companyId,
        sql`dr.company_id = ${companyId}::uuid AND dr.report_date = ${date}::date AND dr.deleted_at IS NULL`,
      )} AS lines,
      ${holidaysJson(companyId, date, date)} AS holidays
  `)) as unknown as Array<Record<string, unknown>>;
  const v = viewerOf(user, await resolveAccess(user, r?.['access']), r?.['mates']);
  if (!canSeeTeam(v)) {
    throw new AuthorizationError("Only a Department Admin can see the team's Day Logs");
  }
  const wide = v.isSuper || v.auditor;

  // Team by RIGHTS: everyone (Super Admin / Auditor), else people holding
  // L2+ in a department the viewer is L5 of, plus the viewer's Teams Config
  // mates (canSeeUser — one rule). The viewer's own row stays for an L5 (as
  // before); someone who is here only through mates sees just the mates.
  const all = (r?.['people'] ?? []) as Array<
    PersonAccess & {
      id: string;
      name: string;
      main_dept: string | null;
      departments: Record<string, unknown>;
    }
  >;
  const people = all
    // Owner 2026-10-30: a person whose Day Log is hidden is not on the team.
    .filter(
      (p) =>
        (wide || (canSeeUser(v, p) && (p.id !== v.userId || v.l5.size > 0))) &&
        personOpensDayLog(p),
    )
    .map((p) => ({ ...p, team: wide ? [] : sharedTeamDepts(v, p.departments) }));
  const headers = (r?.['headers'] ?? []) as Array<{
    id: string;
    user_id: string;
    status: DayLogStatus;
    submitted_at: string | null;
  }>;
  const byUser = new Map(headers.map((h) => [h.user_id, h]));
  const linesBy = linesByReport(toLines(r?.['lines']));
  const hol = toHolidays(r?.['holidays']);
  const workingDay = isWorkingDay(date, [...hol.keys()]);
  const rows: TeamDayLogRow[] = people.map((p) => {
    const h = byUser.get(p.id);
    const lines = h ? (linesBy.get(h.id) ?? []) : [];
    const status: DayLogStatus = h?.status ?? 'open';
    const s = summaryOf(lines, nowMin, workingDay);
    const now = currentOf(lines, isToday, s.lastStop, nowMin);
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
}
