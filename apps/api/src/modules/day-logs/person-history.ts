// Day Log — History (ADR-278, owner 2026-11-06): one person's From-To range,
// Super Admin only, for the History screen and PDF. ONE statement carries the
// access, person, lines, day headers, holidays, revisions and replies, so an edit
// in flight cannot give a half-old PDF; no per-day or per-line query. Nothing is
// written. Figures read the same as Team Day Logs (summaryOf) and the person page
// (toPersonDayEntry); the Not entered rule is pending.ts's isNotEntered.

import {
  type DayLogHistory,
  type DayLogHistoryDay,
  type DayLogHistoryDayState,
  type DayLogHistoryQuery,
  type DayLogStatus,
  dayLogHistoryRangeError,
  isWorkingDay,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { db } from '../../db/client';
import type { AuthContext } from '../../db/with-user-context';
import { AuthorizationError, NotFoundError, ValidationError } from '../../lib/errors';
import { addDays, istDateOf } from '../dashboard/personal/util';
import {
  accessJson,
  dayPersonJson,
  deptLabelOf,
  resolveAccess,
  toDayPerson,
  viewerOf,
} from './access';
import { type DayLine, holidaysJson, linesByReport, linesJson, toHolidays, toLines } from './day';
import { summaryOf } from './detail';
import {
  dayRepliesAdminJson,
  groupBy,
  lineFactsOf,
  lineRepliesJson,
  lineRevisionsJson,
  toPersonDayEntry,
} from './entry-facts';
import { isNotEntered } from './pending';
import { toAdminReply } from './replies';
import { type DayLogClock, istClock } from './rules';
import { requireCompany } from './writes';

/** Every date from From Date to To Date, in order. The screen asks the same rule. */
function datesOf(q: DayLogHistoryQuery, today: string): string[] {
  const refused = dayLogHistoryRangeError(q.from, q.to, today);
  if (refused) throw new ValidationError(refused);
  const dates: string[] = [];
  for (let d = q.from; d <= q.to; d = addDays(d, 1)) dates.push(d);
  return dates;
}

/** One date's state. Lines win over everything, as `blank` does on the person page. */
function stateOf(
  date: string,
  f: { today: boolean; entered: boolean; leave: boolean; notEntered: boolean; holiday: boolean },
): DayLogHistoryDayState {
  if (f.today) return 'today';
  if (f.entered) return 'filled';
  if (f.leave) return 'leave';
  if (f.notEntered) return 'not_entered';
  if (!isWorkingDay(date, [])) return 'sunday';
  return f.holiday ? 'holiday' : 'not_counted';
}

/** The IST date first saved, when later than the date the entry is for. */
const laterSave = (loggedAt: string, date: string): string | null => {
  const saved = istDateOf(new Date(loggedAt));
  return saved > date ? saved : null;
};

const sum = <T>(rows: readonly T[], of: (r: T) => number): number =>
  rows.reduce((n, r) => n + of(r), 0);

/** GET /day-logs/person-history */
export async function getPersonHistory(
  query: DayLogHistoryQuery,
  user: AuthContext,
  clock: DayLogClock = istClock(), // tests only — routes never pass it
): Promise<DayLogHistory> {
  const companyId = requireCompany(user);
  const dates = datesOf(query, clock.today);
  const { from, to } = query;
  const period = sql`dr.company_id = ${companyId}::uuid AND dr.user_id = ${query.userId}::uuid
    AND dr.report_date BETWEEN ${from}::date AND ${to}::date AND dr.deleted_at IS NULL`;
  const lineIds = sql`ARRAY(
    SELECT l.id FROM public.daily_report_lines l
    JOIN public.daily_reports dr ON dr.id = l.daily_report_id
    WHERE l.company_id = ${companyId}::uuid AND l.deleted_at IS NULL
      AND l.from_time IS NOT NULL AND ${period})`;
  const [r] = (await db.execute(sql`
    SELECT ${accessJson(user.id, companyId)} AS access,
      ${dayPersonJson(companyId, query.userId)} AS person,
      ${linesJson(companyId, period)} AS lines,
      (SELECT COALESCE(json_agg(json_build_object('id', dr.id::text,
                'date', to_char(dr.report_date, 'YYYY-MM-DD'), 'status', dr.day_status)), '[]'::json)
       FROM public.daily_reports dr WHERE ${period}) AS headers,
      ${holidaysJson(companyId, from, to)} AS holidays,
      ${lineRevisionsJson(companyId, lineIds)} AS revs,
      ${lineRepliesJson(companyId, lineIds)} AS replies,
      ${dayRepliesAdminJson(companyId, period)} AS day_replies
  `)) as unknown as Array<Record<string, unknown>>;
  const v = viewerOf(user, await resolveAccess(user, r?.['access']));
  if (!v.isSuper) throw new AuthorizationError('Only a Super Admin can see Day Log History');
  const person = toDayPerson(r?.['person']);
  if (!person) throw new NotFoundError('Day Log not found');

  const canReply = person.id !== v.userId; // nobody replies on their own entry
  const holidays = toHolidays(r?.['holidays']);
  const holidayDates = [...holidays.keys()];
  const headers = new Map(
    ((r?.['headers'] ?? []) as Array<{ id: string; date: string; status: DayLogStatus }>).map(
      (h) => [h.date, h],
    ),
  );
  const linesBy = linesByReport(toLines(r?.['lines'])); // each day in time order
  const facts = lineFactsOf(r?.['revs'], r?.['replies'], user.id);
  const dayRepliesBy = groupBy(
    (r?.['day_replies'] ?? []) as Array<Record<string, unknown>>,
    (q) => String(q['report_date']),
    (q) => toAdminReply(q, user.id),
  );

  let filledDays = 0; // state filled, or today with a line: every date with a line
  const days = dates.map((date): DayLogHistoryDay => {
    const h = headers.get(date);
    const lines = h ? (linesBy.get(h.id) ?? []) : [];
    if (lines.length > 0) filledDays += 1;
    const nowMin = date === clock.today ? clock.nowMin : undefined;
    const s = summaryOf(lines, nowMin, isWorkingDay(date, holidayDates));
    // Sr No: the place by Start among the timed lines; an old line with no time
    // makes the day filled but is not an entry.
    const entries = lines
      .filter((l) => l.fromTime)
      .map((l, i) => ({
        ...toPersonDayEntry(l, i + 1, facts, { nowMin, admin: true, canReply }),
        kind: l.kind,
        pending: l.pending,
        savedLaterOn: laterSave(l.loggedAt, date),
      }));
    const dayReplies = dayRepliesBy.get(date) ?? [];
    return {
      date,
      state: stateOf(date, {
        today: date === clock.today,
        entered: lines.length > 0,
        leave: h?.status === 'leave',
        notEntered: isNotEntered(person, date, false, holidayDates, clock),
        holiday: holidays.has(date),
      }),
      holidayName: holidays.get(date) ?? null,
      firstStart: s.firstStart,
      lastStop: s.lastStop,
      workMin: s.workMin,
      entryCount: s.entryCount,
      editedEntries: entries.filter((e) => (e.entryRevNo ?? 0) > 0).length,
      edits: sum(entries, (e) => e.entryRevNo ?? 0),
      replies: sum(entries, (e) => e.replies.length) + dayReplies.length,
      savedLater: entries.filter((e) => e.savedLaterOn).length,
      entries,
      dayReplies,
    };
  });

  const allEntries = days.flatMap((d) => d.entries);
  const minutesOf = (kind: DayLine['kind']): number =>
    sum(
      allEntries.filter((e) => e.kind === kind),
      (e) => e.minutes,
    );
  const notEntered = days.filter((d) => d.state === 'not_entered').length;
  const workingDays = filledDays + notEntered;
  const workMin = sum(days, (d) => d.workMin);
  return {
    userId: person.id,
    userName: person.name,
    deptLabel: deptLabelOf(person.mainDept),
    from,
    to,
    today: clock.today,
    days,
    totals: {
      workingDays,
      filledDays,
      notEntered,
      offDays: days.filter((d) => d.state === 'sunday' || d.state === 'holiday').length,
      leaveDays: days.filter((d) => d.state === 'leave').length,
      entries: sum(days, (d) => d.entryCount),
      workMin,
      avgDailyWorkMin: filledDays > 0 ? Math.round(workMin / filledDays) : 0,
      breakMin: minutesOf('break'),
      leaveMin: minutesOf('leave'),
      editedEntries: sum(days, (d) => d.editedEntries),
      edits: sum(days, (d) => d.edits),
      replies: sum(days, (d) => d.replies),
      savedLater: sum(days, (d) => d.savedLater),
    },
    hasContent: workingDays > 0 || days.some((d) => d.state === 'leave' || d.replies > 0),
  };
}
