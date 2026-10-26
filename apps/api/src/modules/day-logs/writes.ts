// Day Log — what every owner write shares: the guards, the entry lock and
// the ONE validation of an entry (entries.ts uses it for add and edit).
// Every write: requireCanWrite (no page tick — ADR-232) → lock the day header
// FOR UPDATE (openDay / lockHeaderById) → re-read the lines INSIDE that lock
// → validate → write → bump the header (§20.3). `hours` is written only by
// entries.ts, from From/To (§20.1).

import { type DayLogDetail, type DayLogEntryKind, hhmmToMin, minToHhmm } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { isUniqueViolation } from '../../lib/db-retry';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { type Viewer, loadDayUser } from './access';
import { type DayHeader, type DayLine, lockHeaderById, spansOf } from './day';
import { buildDetail, findBlockedBy, findStrayOpen, notOpenError } from './detail';
import {
  type DayLogClock,
  breakLimitProblem,
  breakTotalWith,
  dmy,
  findOverlap,
  istHm,
} from './rules';

export const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

/** `hours` of a line: From–To in hours; 0 while Open. */
export const hoursOf = (fromTime: string, toTime: string | null): string =>
  toTime ? ((hhmmToMin(toTime) - hhmmToMin(fromTime)) / 60).toFixed(2) : '0';

/** A 23505 from the one-Open-entry index (drizzle may wrap the pg error). */
export const uniqueHit = (e: unknown): boolean =>
  isUniqueViolation(e) || isUniqueViolation((e as { cause?: unknown } | null)?.cause);

/** Open day, not in the future, no Open entry left on another day, D3. */
export async function guardOwnerWrite(
  tx: DbTransaction,
  companyId: string,
  h: DayHeader,
  today: string,
): Promise<void> {
  if (h.status !== 'open') throw notOpenError(h);
  if (h.date > today) throw new ValidationError(`${dmy(h.date)} has not come yet`);
  const [stray, blocked] = await Promise.all([
    findStrayOpen(tx, companyId, h.userId, today),
    findBlockedBy(tx, companyId, h.userId, h.date),
  ]);
  if (stray && stray.date !== h.date) {
    throw new ConflictError(
      `Your entry on ${dmy(stray.date)} is still Open since ${stray.fromTime} — give it a Stop time first`,
    );
  }
  if (blocked) throw new ConflictError(blocked.reason);
}

export async function ownerDetail(
  tx: DbTransaction,
  companyId: string,
  v: Viewer,
  user: AuthContext,
  date: string,
  clock: DayLogClock,
): Promise<DayLogDetail> {
  const me = await loadDayUser(tx, companyId, user.id);
  if (!me) throw new NotFoundError('User not found');
  return buildDetail(tx, companyId, v, me, date, clock);
}

/** The entry's day, locked; owner only (someone else's → not found). */
export async function lockOwnEntry(
  tx: DbTransaction,
  companyId: string,
  user: AuthContext,
  entryId: string,
): Promise<DayHeader> {
  const rows = (await tx.execute(sql`
    SELECT l.daily_report_id::text AS report_id FROM public.daily_report_lines l
    JOIN public.daily_reports dr ON dr.id = l.daily_report_id AND dr.deleted_at IS NULL
    WHERE l.id = ${entryId}::uuid AND l.company_id = ${companyId}::uuid AND l.deleted_at IS NULL
      AND dr.user_id = ${user.id}::uuid
  `)) as unknown as Array<{ report_id: string }>;
  const reportId = rows[0]?.report_id;
  if (!reportId) throw new NotFoundError('Entry not found');
  // The day lock (§20.3).
  const h = await lockHeaderById(tx, companyId, reportId);
  if (!h) throw new NotFoundError('Entry not found');
  return h;
}

/** 409 for an edit whose loaded updatedAt is no longer the entry's (§20.4). */
export function staleEntryError(currentUpdatedAt: string): ConflictError {
  // Only the owner writes their entries, so the other change is theirs too.
  return new ConflictError(
    `You changed this entry in another window at ${istHm(currentUpdatedAt)} — reload and redo your change`,
  );
}

export interface EntryCandidate {
  kind: DayLogEntryKind;
  fromTime: string;
  toTime: string | null;
  hasOrder: boolean;
}

/** The caller's Open entry on ANY day other than `exceptId` (one at a time). */
async function openElsewhere(
  tx: DbTransaction,
  companyId: string,
  userId: string,
  exceptId: string | null,
): Promise<{ date: string; fromTime: string } | null> {
  const rows = (await tx.execute(sql`
    SELECT to_char(dr.report_date, 'YYYY-MM-DD') AS d, to_char(l.from_time, 'HH24:MI') AS f
    FROM public.daily_report_lines l
    JOIN public.daily_reports dr ON dr.id = l.daily_report_id AND dr.deleted_at IS NULL
    WHERE dr.company_id = ${companyId}::uuid AND dr.user_id = ${userId}::uuid
      AND l.to_time IS NULL AND l.from_time IS NOT NULL AND l.deleted_at IS NULL
      ${exceptId ? sql`AND l.id <> ${exceptId}::uuid` : sql``}
    LIMIT 1
  `)) as unknown as Array<{ d: string; f: string }>;
  const r = rows[0];
  return r ? { date: r.d, fromTime: r.f } : null;
}

/**
 * Every rule of one entry, checked under the day lock against the day's
 * OTHER live lines (`others` excludes the entry being edited).
 */
export async function validateEntry(
  tx: DbTransaction,
  companyId: string,
  h: DayHeader,
  others: readonly DayLine[],
  cand: EntryCandidate,
  exceptId: string | null,
  clock: DayLogClock,
): Promise<void> {
  const isToday = h.date === clock.today;
  const nowMin = isToday ? clock.nowMin : undefined;
  const nowHm = minToHhmm(clock.nowMin);
  if (h.date > clock.today) throw new ValidationError(`${dmy(h.date)} has not come yet`);
  if (isToday && hhmmToMin(cand.fromTime) > clock.nowMin) {
    throw new ValidationError(`Start ${cand.fromTime} is later than now (${nowHm})`);
  }
  if (isToday && cand.toTime && hhmmToMin(cand.toTime) > clock.nowMin) {
    throw new ValidationError(`Stop ${cand.toTime} is later than now (${nowHm})`);
  }
  if (!isToday && !cand.toTime) {
    throw new ValidationError(`Give a Stop time — ${dmy(h.date)} is over`);
  }
  if (cand.kind === 'break' && cand.hasOrder) {
    throw new ValidationError('A break cannot be for an SO / JWSO');
  }
  if (!cand.toTime) {
    const open = await openElsewhere(tx, companyId, h.userId, exceptId);
    if (open) {
      const where = open.date === h.date ? '' : ` on ${dmy(open.date)}`;
      throw new ConflictError(
        `Your entry${where} since ${open.fromTime} is still Open — stop it first`,
      );
    }
  }
  const spans = others
    .filter((l) => l.fromTime)
    .map((l) => ({
      id: l.id,
      kind: l.kind,
      fromTime: l.fromTime!,
      toTime: l.toTime,
      description: l.description,
    }));
  const hit = findOverlap(spans, cand, nowMin);
  if (hit) {
    throw new ValidationError(
      `Overlaps ${hit.fromTime} – ${hit.toTime ?? 'now'} ${hit.description} — entries cannot share time`,
    );
  }
  if (cand.kind === 'break') {
    const problem = breakLimitProblem(breakTotalWith(spansOf(others), cand, nowMin));
    if (problem) throw new ValidationError(problem);
  }
}
