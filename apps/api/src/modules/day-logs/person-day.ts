// Day Log — Team Day Logs › a person, ONE day (ADR-255): the entries with
// Sr No by Start Time, and — for a Super Admin only — each entry's Entry Revs
// (ADR-256: the whole entry — Working On, Start, Stop, SO / JWSO — after every
// changed save) and the replies. Anyone else allowed to see the person
// (canSeeUser) gets the entries with no revision fact and no replies.
// Pending Entries: dayReplies (the blank day's own replies, Super Admin only),
// canReplyDay and notEntered.
// Statements: 1 (access, person, lines, day facts) + 1 more for a Super Admin (every
// revision and reply of the day's lines, two json aggregates) + 1 when they may
// reply (replyGoesToInbox, the person's access) — no per-entry query.

import type { DayLogPersonDay, DayLogPersonDayQuery, DayLogStatus } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { db } from '../../db/client';
import type { AuthContext } from '../../db/with-user-context';
import { usableAssignee } from '../tasks/service';
import {
  accessJson,
  dayPersonJson,
  deptLabelOf,
  matesJson,
  resolveAccess,
  toDayPerson,
  viewerOf,
  visibleUser,
} from './access';
import { holidaysJson, linesJson, toHolidays, toLines } from './day';
import { dayReplyBlock } from './day-replies';
import {
  dayRepliesAdminJson,
  lineFactsOf,
  lineRepliesJson,
  lineRevisionsJson,
  toPersonDayEntry,
} from './entry-facts';
import { dayTx } from './lock';
import { isNotEntered } from './pending';
import { toAdminReply } from './replies';
import { type DayLogClock, istClock } from './rules';
import { requireCompany } from './writes';

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
      ${matesJson(user.id, companyId)} AS mates,
      ${dayPersonJson(companyId, query.userId)} AS target,
      ${linesJson(companyId, day)} AS lines,
      (SELECT dr.day_status FROM public.daily_reports dr WHERE ${day}) AS day_status,
      ${holidaysJson(companyId, date, date)} AS holidays,
      ${dayRepliesAdminJson(companyId, day)} AS day_replies
  `)) as unknown as Array<Record<string, unknown>>;
  // A Teams Config mate is not a Super Admin: no revisions, no replies.
  const v = viewerOf(user, await resolveAccess(user, r?.['access']), r?.['mates']);
  const person = toDayPerson(r?.['target']);
  const target = visibleUser(v, person);
  // Every live line counts as "entered"; the sheet shows only the timed ones.
  const allLines = toLines(r?.['lines']);
  const lines = allLines.filter((l) => l.fromTime);
  const nowMin = date === clock.today ? clock.nowMin : undefined;

  // A Super Admin sees every Entry Rev, their OWN entries included (owner
  // 2026-10-30, ADR-256). Nobody replies on their own entry, so the replies
  // (and the reply box) are for someone else's day only.
  const admin = v.isSuper;
  const canReply = admin && target.id !== v.userId;
  const status = (r?.['day_status'] as DayLogStatus | null) ?? 'open';
  const holidays = [...toHolidays(r?.['holidays']).keys()];
  const blank = allLines.length === 0;
  let facts = lineFactsOf(null, null, user.id);
  if (admin && lines.length > 0) {
    const ids = sql`${sql.param(lines.map((l) => l.id))}::uuid[]`;
    const [x] = (await db.execute(sql`
      SELECT ${lineRevisionsJson(companyId, ids)} AS revs,
        ${lineRepliesJson(companyId, ids)} AS replies
    `)) as unknown as Array<{ revs: unknown; replies: unknown }>;
    facts = lineFactsOf(x?.revs, x?.replies, user.id);
  }

  // ADR-274 — asked only of a Super Admin who may reply; others pay nothing.
  const replyGoesToInbox =
    canReply && (await dayTx((tx) => usableAssignee(tx, companyId, target.id))) !== null;

  return {
    userId: target.id,
    userName: target.name,
    deptLabel: deptLabelOf(target.mainDept),
    date,
    today: clock.today,
    isSuperAdmin: admin,
    canReply,
    // linesJson is in time order (Start, then line_no) — Sr No follows it.
    entries: lines.map((l, i) => toPersonDayEntry(l, i + 1, facts, { nowMin, admin, canReply })),
    dayReplies: admin
      ? ((r?.['day_replies'] ?? []) as Array<Record<string, unknown>>).map((q) =>
          toAdminReply(q, user.id),
        )
      : [],
    canReplyDay:
      canReply &&
      v.writer &&
      blank &&
      dayReplyBlock(person, date, status, holidays, clock) === null,
    replyGoesToInbox,
    notEntered: admin && isNotEntered(person!, date, !blank || status === 'leave', holidays, clock),
  };
}
