// Day Log — the D3 check (an unfinished earlier working day), the stray
// Open entry on an earlier day, the entry shape and the whole DayLogDetail —
// all judged in memory on one snapshot (snapshot.ts).

import {
  DAY_LOG_LATE_COMING,
  type DayLogDetail,
  type DayLogEntry,
  type DayLogStatus,
  type DayLogSummaryOut,
  fmt12,
  isWorkingDay,
  minToHhmm,
  summarizeDay,
} from '@innovic/shared';
import type { DbTransaction } from '../../db/with-user-context';
import { ConflictError } from '../../lib/errors';
import { addDays } from '../dashboard/personal/util';
import { type DayUser, type Viewer, canManageUser, deptLabelOf } from './access';
import { type DayHeader, type DayLine, spansOf } from './day';
import { dmy, entryMinutes, istHm, lastEntryOf } from './rules';
import { type DaySnapshot, LOOKBACK_DAYS, type OpenLine, readSnapshot } from './snapshot';

/**
 * D3 — the user's most recent working day before `date` must be finished
 * (submitted, Leave, or nothing missing). Never blocks someone with no day
 * before `date` at all (a new user). Judged on the snapshot of `date`.
 */
export function blockedByOf(
  snap: DaySnapshot,
  date: string,
): { date: string; reason: string } | null {
  if (!snap.hasEarlier) return null;
  const holDates = [...snap.holidays.keys()];
  let prev = addDays(date, -1);
  for (let i = 0; i < LOOKBACK_DAYS && !isWorkingDay(prev, holDates); i += 1)
    prev = addDays(prev, -1);
  // D3 — the day must be Submitted (or Leave), not merely filled.
  const status = snap.earlier.get(prev);
  if (status && status !== 'open') return null;
  return {
    date: prev,
    reason: `${dmy(prev)} is not finished — complete and submit it, or ask your Department Admin to mark Leave`,
  };
}

/** D3 on its own (Submit) — one statement. */
export async function findBlockedBy(
  tx: DbTransaction,
  companyId: string,
  userId: string,
  date: string,
): Promise<{ date: string; reason: string } | null> {
  const snap = await readSnapshot({ companyId, viewerId: null, targetId: userId, date }, tx);
  return blockedByOf(snap, date);
}

/** An entry (work or break) left Open on a day before `today`. */
export function strayOpenOf(
  openLines: readonly OpenLine[],
  today: string,
): { date: string; entryId: string; fromTime: string } | null {
  const r = openLines.find((l) => l.date < today); // latest day first
  return r ? { date: r.date, entryId: r.id, fromTime: r.fromTime } : null;
}

/** `nowMin` only when the line's day is today (an Open entry counts to now). */
export function toEntry(l: DayLine, nowMin?: number): DayLogEntry {
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
  };
}

/** Minutes of the day's FIRST entry when it is Others · Late coming, else 0. */
export function lateInOf(lines: readonly DayLine[], nowMin?: number): number {
  const first = lines
    .filter((l) => l.fromTime)
    .reduce<DayLine | null>((a, l) => (!a || l.fromTime! < a.fromTime! ? l : a), null);
  return first?.kind === 'leave' && first.description === DAY_LOG_LATE_COMING
    ? entryMinutes(first.fromTime!, first.toTime, nowMin)
    : 0;
}

/** summarizeDay + the LATE count — one reading for detail, team and person. */
export function summaryOf(
  lines: readonly DayLine[],
  nowMin: number | undefined,
  workingDay: boolean,
  status: DayLogStatus,
): DayLogSummaryOut {
  const s = summarizeDay(spansOf(lines), nowMin, workingDay);
  // Judged over the whole 09:00–18:00 window — the same test Submit uses —
  // so the screen never offers a Submit the server refuses (§20.5).
  const whole = summarizeDay(spansOf(lines), undefined, workingDay).unloggedMin;
  return {
    ...s,
    // Strict order: where the next entry must start (null while one is Open).
    // A Leave day owes no time.
    unloggedMin: status === 'leave' ? 0 : whole,
    lateCount: lines.filter((l) => l.late).length,
    lateInMin: lateInOf(lines, nowMin),
  };
}

/** The whole DayLogDetail for (target, date), as the viewer sees it, from
 *  a snapshot of that day (read, or brought up to date after a write). */
export function detailOf(
  snap: Pick<DaySnapshot, 'header' | 'lines' | 'holidays' | 'openLines'>,
  blockedBy: { date: string; reason: string } | null,
  v: Viewer,
  target: DayUser,
  date: string,
  clock: { today: string; nowMin: number },
): DayLogDetail {
  const { header, lines } = snap;
  const strayOpen = strayOpenOf(snap.openLines, clock.today);
  const holidayName = snap.holidays.get(date) ?? null;
  const workingDay = isWorkingDay(date, holidayName ? [date] : []);
  const nowMin = date === clock.today ? clock.nowMin : undefined;
  const status: DayLogStatus = header?.status ?? 'open';
  const summary = summaryOf(lines, nowMin, workingDay, status);

  const isOwner = target.id === v.userId;

  return {
    id: header?.id ?? null,
    userId: target.id,
    userName: target.name,
    deptLabel: deptLabelOf(target.mainDept),
    date,
    today: clock.today,
    nowTime: minToHhmm(clock.nowMin),
    status,
    workingDay,
    holidayName,
    entries: lines.filter((l) => l.fromTime).map((l) => toEntry(l, nowMin)),
    summary,
    submittedAt: header?.submittedAt ?? null,
    submittedByName: header?.submittedByName ?? null,
    reopenedAt: header?.reopenedAt ?? null,
    reopenedByName: header?.reopenedByName ?? null,
    reopenReason: header?.reopenReason ?? null,
    leaveReason: header?.leaveReason ?? null,
    blockedBy,
    strayOpen,
    isOwner,
    canWrite:
      isOwner &&
      v.writer &&
      status === 'open' &&
      !blockedBy &&
      date <= clock.today &&
      (!strayOpen || strayOpen.date === date),
    canManage: canManageUser(v, target) && (!isOwner || v.isSuper),
    lastEntryId: lastEntryOf(lines.filter((l) => l.fromTime))?.id ?? null,
  };
}

/** detailOf on a fresh read — ONE statement (Submit / Reopen / Leave). */
export async function buildDetail(
  tx: DbTransaction,
  companyId: string,
  v: Viewer,
  target: DayUser,
  date: string,
  clock: { today: string; nowMin: number },
): Promise<DayLogDetail> {
  const snap = await readSnapshot({ companyId, viewerId: null, targetId: target.id, date }, tx);
  return detailOf(snap, blockedByOf(snap, date), v, target, date, clock);
}

/** 409 for a write on a day that is not open, naming who closed it and when. */
export function notOpenError(h: DayHeader): ConflictError {
  const at = (s: string | null): string => (s ? fmt12(istHm(s)) : '');
  if (h.status === 'submitted') {
    return new ConflictError(
      `${dmy(h.date)} was submitted by ${h.submittedByName ?? 'someone'} at ${at(h.submittedAt)} — ask your Department Admin to reopen it`,
    );
  }
  return new ConflictError(
    `${dmy(h.date)} is marked Leave by ${h.updatedByName ?? 'your Department Admin'} — ask your Department Admin to reopen it`,
  );
}
