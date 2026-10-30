// Day Log — Team Day Logs › a person, ONE day (ADR-255): the entries with
// Sr No by Start Time, and — for a Super Admin only — each entry's Entry Revs
// (ADR-256: the whole entry — Working On, Start, Stop, SO / JWSO — after every
// changed save) and the replies. Anyone else allowed to see the person
// (canSeeUser) gets the entries with no revision fact and no replies.
// Statements: 1 (access, person, lines) + 1 more for a Super Admin (every
// revision and reply of the day's lines, two json aggregates) — no per-entry query.

import type {
  DayLogAdminReply,
  DayLogEntryRevision,
  DayLogPersonDay,
  DayLogPersonDayQuery,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { db } from '../../db/client';
import type { AuthContext } from '../../db/with-user-context';
import {
  accessJson,
  dayUserJson,
  deptLabelOf,
  resolveAccess,
  toDayUser,
  viewerOf,
  visibleUser,
} from './access';
import { linesJson, toLines, ts } from './day';
import { ADMIN_REPLY_COLS, toAdminReply } from './replies';
import { type DayLogClock, entryMinutes, istClock } from './rules';
import { requireCompany } from './writes';

type RevRow = DayLogEntryRevision & { lineId: string };

/** The SO / JWSO of a revision row (alias tr) as json, with its code — or null. */
const REV_ORDER = sql.raw(`CASE
  WHEN tr.sales_order_id IS NOT NULL THEN json_build_object(
    'type', 'so', 'id', tr.sales_order_id::text,
    'code', (SELECT s.code FROM public.sales_orders s
             WHERE s.id = tr.sales_order_id AND s.company_id = tr.company_id))
  WHEN tr.job_work_order_id IS NOT NULL THEN json_build_object(
    'type', 'jwso', 'id', tr.job_work_order_id::text,
    'code', (SELECT j.code FROM public.job_work_orders j
             WHERE j.id = tr.job_work_order_id AND j.company_id = tr.company_id))
  END`);

/** Group json rows by their line id. */
function byLine<T extends { lineId: string }>(rows: readonly T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) m.set(r.lineId, [...(m.get(r.lineId) ?? []), r]);
  return m;
}

export async function getPersonDay(
  query: DayLogPersonDayQuery,
  user: AuthContext,
  clock: DayLogClock = istClock(), // tests only — routes never pass it
): Promise<DayLogPersonDay> {
  const companyId = requireCompany(user);
  const date = query.date ?? clock.today;
  const day = sql`dr.company_id = ${companyId}::uuid AND dr.user_id = ${query.userId}::uuid
    AND dr.report_date = ${date}::date AND dr.deleted_at IS NULL`;
  const [r] = (await db.execute(sql`
    SELECT ${accessJson(user.id, companyId)} AS access,
      ${dayUserJson(companyId, query.userId)} AS target,
      ${linesJson(companyId, day)} AS lines
  `)) as unknown as Array<Record<string, unknown>>;
  const v = viewerOf(user, await resolveAccess(user, r?.['access']));
  const target = visibleUser(v, toDayUser(r?.['target']));
  const lines = toLines(r?.['lines']).filter((l) => l.fromTime);
  const nowMin = date === clock.today ? clock.nowMin : undefined;

  // A Super Admin sees every Entry Rev, their OWN entries included (owner
  // 2026-10-30, ADR-256). Nobody replies on their own entry, so the replies
  // (and the reply box) are for someone else's day only.
  const admin = v.isSuper;
  const canReply = admin && target.id !== v.userId;
  let revs = new Map<string, RevRow[]>();
  let replies = new Map<string, Array<{ lineId: string; reply: DayLogAdminReply }>>();
  if (admin && lines.length > 0) {
    const ids = lines.map((l) => l.id);
    const [x] = (await db.execute(sql`
      SELECT
        (SELECT COALESCE(json_agg(json_build_object(
                  'lineId', tr.line_id::text, 'entryRevNo', tr.entry_rev_no,
                  'description', tr.description,
                  'fromTime', to_char(tr.from_time, 'HH24:MI'),
                  'toTime', to_char(tr.to_time, 'HH24:MI'),
                  'order', ${REV_ORDER}, 'savedAt', ${ts('tr.saved_at')})
                ORDER BY tr.line_id, tr.entry_rev_no DESC), '[]'::json)
         FROM public.daily_report_line_revisions tr
         WHERE tr.company_id = ${companyId}::uuid AND tr.deleted_at IS NULL
           AND tr.line_id = ANY(${sql.param(ids)}::uuid[])) AS revs,
        (SELECT COALESCE(json_agg(row_to_json(q) ORDER BY q.sent_at, q.id), '[]'::json) FROM (
           SELECT rp.line_id::text AS line_id, ${ADMIN_REPLY_COLS}
           FROM public.daily_report_line_replies rp
           JOIN public.users au ON au.id = rp.created_by
           WHERE rp.company_id = ${companyId}::uuid AND rp.deleted_at IS NULL
             AND rp.line_id = ANY(${sql.param(ids)}::uuid[])) q) AS replies
    `)) as unknown as Array<{
      revs: RevRow[] | null;
      replies: Array<Record<string, unknown>> | null;
    }>;
    revs = byLine(x?.revs ?? []);
    replies = byLine(
      (x?.replies ?? []).map((q) => ({ lineId: String(q['line_id']), reply: toAdminReply(q) })),
    );
  }

  return {
    userId: target.id,
    userName: target.name,
    deptLabel: deptLabelOf(target.mainDept),
    date,
    today: clock.today,
    isSuperAdmin: admin,
    canReply,
    // linesJson is in time order (Start, then line_no) — Sr No follows it.
    entries: lines.map((l, i) => {
      const lr = admin ? (revs.get(l.id) ?? []) : [];
      const top = lr[0]; // newest first
      return {
        id: l.id,
        srNo: i + 1,
        fromTime: l.fromTime!,
        toTime: l.toTime,
        minutes: entryMinutes(l.fromTime!, l.toTime, nowMin),
        order: l.order,
        description: l.description,
        entryRevNo: admin ? (top?.entryRevNo ?? 0) : null,
        entryRevisedAt: admin && top && top.entryRevNo > 0 ? top.savedAt : null,
        revisions: lr.map(({ entryRevNo, description, fromTime, toTime, order, savedAt }) => ({
          entryRevNo,
          description,
          fromTime,
          toTime,
          order,
          savedAt,
        })),
        replies: canReply ? (replies.get(l.id) ?? []).map((q) => q.reply) : [],
      };
    }),
  };
}
