// Day Log — the entry shape and the whole DayLogDetail —
// all judged in memory on one snapshot (snapshot.ts).

import {
  type DayLogDetail,
  type DayLogEntry,
  type DayLogSummaryOut,
  isWorkingDay,
  minToHhmm,
  summarizeDay,
} from '@innovic/shared';
import { type DayUser, type Viewer, canApproveUser, deptLabelOf } from './access';
import { type DayLine, spansOf } from './day';
import { blockedByOf, entryMinutes } from './rules';
import type { DaySnapshot } from './snapshot';

/** Yesterday first (rules.ts — pure, unit-tested). */
export { blockedByOf };

/** `nowMin` only when the line's day is today (an old Open entry counts to now).
 *  `withReplies` — ADR-255: only the entry's owner and a Super Admin. */
export function toEntry(l: DayLine, nowMin?: number, withReplies = false): DayLogEntry {
  return {
    id: l.id,
    kind: l.kind,
    fromTime: l.fromTime ?? '',
    toTime: l.toTime,
    minutes: l.fromTime ? entryMinutes(l.fromTime, l.toTime, nowMin) : 0,
    description: l.description,
    order: l.order,
    remarks: l.remarks,
    late: l.late,
    updatedAt: l.updatedAt,
    replies: withReplies ? (l.replies ?? []) : [],
    pending: l.pending,
    rejectReason: l.rejectReason,
  };
}

/** summarizeDay + the LATE count — one reading for detail, team and person.
 *  Every row is work now: break / Others / late-in read 0, no strict order. */
export function summaryOf(
  lines: readonly DayLine[],
  nowMin: number | undefined,
  workingDay: boolean,
): DayLogSummaryOut {
  const s = summarizeDay(spansOf(lines), nowMin, workingDay);
  return {
    ...s,
    breakMin: 0,
    leaveMin: 0,
    unloggedMin: summarizeDay(spansOf(lines), undefined, workingDay).unloggedMin,
    nextStart: null,
    lateCount: lines.filter((l) => l.late).length,
    lateInMin: 0,
  };
}

/** The whole DayLogDetail for (target, date), as the viewer sees it, from
 *  a snapshot of that day (read, or brought up to date after a write). */
export function detailOf(
  snap: Pick<DaySnapshot, 'header' | 'lines' | 'holidays'>,
  blockedBy: { date: string; reason: string } | null,
  v: Viewer,
  target: DayUser,
  date: string,
  clock: { today: string; nowMin: number },
): DayLogDetail {
  const { header, lines } = snap;
  const holidayName = snap.holidays.get(date) ?? null;
  const workingDay = isWorkingDay(date, holidayName ? [date] : []);
  const nowMin = date === clock.today ? clock.nowMin : undefined;
  const isOwner = target.id === v.userId;
  const withReplies = isOwner || v.isSuper;

  return {
    id: header?.id ?? null,
    userId: target.id,
    userName: target.name,
    deptLabel: deptLabelOf(target.mainDept),
    date,
    today: clock.today,
    nowTime: minToHhmm(clock.nowMin),
    status: header?.status ?? 'open',
    workingDay,
    holidayName,
    entries: lines.filter((l) => l.fromTime).map((l) => toEntry(l, nowMin, withReplies)),
    summary: summaryOf(lines, nowMin, workingDay),
    submittedAt: header?.submittedAt ?? null,
    submittedByName: header?.submittedByName ?? null,
    reopenedAt: header?.reopenedAt ?? null,
    reopenedByName: header?.reopenedByName ?? null,
    reopenReason: header?.reopenReason ?? null,
    leaveReason: header?.leaveReason ?? null,
    blockedBy,
    strayOpen: null,
    isOwner,
    canWrite: isOwner && v.writer && !blockedBy && date <= clock.today,
    // The viewer may approve this person's edits (never their own).
    canManage: canApproveUser(v, target),
    lastEntryId: null,
  };
}
