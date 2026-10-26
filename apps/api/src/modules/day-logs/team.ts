// Day Log — Team Day Logs: one row per person the viewer may see, for one
// date. Two reads (headers, lines) for the whole team, no per-person query.

import {
  ACCESS_TIERS,
  type DayLogStatus,
  type TeamDayLogQuery,
  type TeamDayLogResponse,
  type TeamDayLogRow,
  isWorkingDay,
  summarizeDay,
} from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import { canManageUser, canSeeTeam, deptLabelOf, loadViewer, tierIn } from './access';
import { type DayLine, holidaysBetween, spansOf } from './day';
import { firstGap, hm, istClock } from './rules';
import { requireCompany } from './writes';

const tierLabel = (key: string | null): string | null => {
  const t = key ? ACCESS_TIERS.find((x) => x.key === key) : undefined;
  return t ? `${t.key} ${t.label}` : null;
};

export async function getTeam(
  query: TeamDayLogQuery,
  user: AuthContext,
): Promise<TeamDayLogResponse> {
  const companyId = requireCompany(user);
  const v = await loadViewer(user); // before the tx (ADR-229)
  if (!canSeeTeam(v)) {
    throw new AuthorizationError("Only a Department Admin can see the team's Day Logs");
  }
  const clock = istClock();
  const date = query.date ?? clock.today;
  const nowMin = date === clock.today ? clock.nowMin : undefined;
  const wide = v.isSuper || v.auditor;

  return withUserContext(user, async (tx) => {
    const scope: SQL = wide ? sql`TRUE` : sql`ua.main_dept = ANY(${sql.param([...v.l5])}::text[])`;
    const people = (await tx.execute(sql`
      SELECT u.id::text AS id, COALESCE(u.full_name, u.email) AS name, ua.main_dept,
             COALESCE(ua.departments, '{}'::jsonb) AS departments
      FROM public.users u
      LEFT JOIN public.user_access ua
        ON ua.user_id = u.id AND ua.company_id = ${companyId}::uuid AND ua.deleted_at IS NULL
      WHERE u.company_id = ${companyId}::uuid AND u.deleted_at IS NULL AND u.is_active
        AND ${scope}
      ORDER BY COALESCE(u.full_name, u.email)
    `)) as unknown as Array<{
      id: string;
      name: string;
      main_dept: string | null;
      departments: Record<string, unknown>;
    }>;
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
    const hIds = headers.map((h) => h.id);

    const lineRows = hIds.length
      ? ((await tx.execute(sql`
          SELECT l.daily_report_id::text AS report_id, l.kind,
                 to_char(l.from_time, 'HH24:MI') AS from_time, to_char(l.to_time, 'HH24:MI') AS to_time,
                 l.description
          FROM public.daily_report_lines l
          WHERE l.company_id = ${companyId}::uuid AND l.deleted_at IS NULL
            AND l.from_time IS NOT NULL AND l.daily_report_id = ANY(${sql.param(hIds)}::uuid[])
          ORDER BY l.from_time
        `)) as unknown as Array<Record<string, unknown>>)
      : [];
    const linesBy = new Map<string, DayLine[]>();
    for (const r of lineRows) {
      const k = String(r['report_id']);
      const arr = linesBy.get(k) ?? [];
      arr.push({
        id: '',
        kind: r['kind'] as 'work' | 'break',
        fromTime: hm(r['from_time'] as string),
        toTime: hm(r['to_time'] as string | null),
        description: String(r['description'] ?? ''),
        taskId: null,
        taskLabel: null,
        status: '',
        stopNote: null,
        updatedAt: '',
      });
      linesBy.set(k, arr);
    }

    // People without a header yet: their own break template decides the window.
    const noHeader = ids.filter((id) => !byUser.has(id));
    const tmplRows = noHeader.length
      ? ((await tx.execute(sql`
          SELECT b.user_id::text AS user_id, to_char(b.from_time, 'HH24:MI') AS from_time,
                 to_char(b.to_time, 'HH24:MI') AS to_time
          FROM public.user_break_times b
          WHERE b.company_id = ${companyId}::uuid AND b.deleted_at IS NULL
            AND b.user_id = ANY(${sql.param(noHeader)}::uuid[])
        `)) as unknown as Array<{ user_id: string; from_time: string; to_time: string }>)
      : [];
    const tmplBy = new Map<string, Array<{ kind: 'break'; fromTime: string; toTime: string }>>();
    for (const b of tmplRows) {
      const arr = tmplBy.get(b.user_id) ?? [];
      arr.push({ kind: 'break', fromTime: b.from_time, toTime: b.to_time });
      tmplBy.set(b.user_id, arr);
    }

    const hol = await holidaysBetween(tx, companyId, date, date);
    const workingDay = isWorkingDay(date, [...hol.keys()]);
    let anyManage = false;
    const rows: TeamDayLogRow[] = people.map((p) => {
      const h = byUser.get(p.id);
      const lines = h ? (linesBy.get(h.id) ?? []) : [];
      const spans = h ? spansOf(lines) : (tmplBy.get(p.id) ?? []);
      const s = summarizeDay(spans, nowMin, workingDay);
      const status: DayLogStatus = h?.status ?? 'open';
      const running = lines.find((l) => l.kind === 'work' && !l.toTime);
      if (canManageUser(v, p.main_dept)) anyManage = true;
      // The tier this person holds in the viewer's department (the L5 one
      // that matches their main department); none for the Super Admin view.
      const viewDept = !wide && p.main_dept && v.l5.has(p.main_dept) ? p.main_dept : null;
      return {
        userId: p.id,
        userName: p.name,
        deptLabel: deptLabelOf(p.main_dept),
        tierLabel: viewDept ? tierLabel(tierIn(p.departments, viewDept)) : null,
        dayLogId: h?.id ?? null,
        status,
        loggedMin: s.loggedMin,
        requiredMin: s.requiredMin,
        missingMin: status === 'leave' ? 0 : s.missingMin,
        missingFrom: status === 'open' && workingDay ? firstGap(spans, nowMin) : null,
        runningNow: running ? `${running.description} since ${running.fromTime}` : null,
        submittedAt: h?.submitted_at
          ? h.submitted_at instanceof Date
            ? h.submitted_at.toISOString()
            : new Date(h.submitted_at).toISOString()
          : null,
      };
    });

    return {
      date,
      today: clock.today,
      workingDay,
      rows,
      canManage: anyManage,
    };
  });
}
