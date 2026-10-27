// Day Log — what every owner write shares: the guards, the entry lock and
// the ONE validation of an entry (entries.ts uses it for add and edit).
// Every write: requireCanWrite (no page tick — ADR-232) → lock the day header
// FOR UPDATE (openDay / lockHeaderById) → re-read the lines INSIDE that lock
// → validate → write → bump the header (§20.3). `hours` is written only by
// entries.ts, from From/To (§20.1).

import {
  DAY_LOG_OTHERS_REASONS,
  DAY_LOG_RULES,
  type DayLogDetail,
  type DayLogEntryKind,
  fmt12,
  hhmmToMin,
  minToHhmm,
  summarizeDay,
} from '@innovic/shared';
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
  lastEntryOf,
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
      `Your entry on ${dmy(stray.date)} is still Open since ${fmt12(stray.fromTime)} — give it a Stop time first`,
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
    `You changed this entry in another window at ${fmt12(istHm(currentUpdatedAt))} — reload and redo your change`,
  );
}

export interface EntryCandidate {
  kind: DayLogEntryKind;
  fromTime: string;
  toTime: string | null;
  hasOrder: boolean;
  description: string;
  remarks: string | null;
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
 * STRICT ORDER (owner 2026-10-26), under the day lock. An earlier entry keeps
 * its stored times and kind (returns 'fixed' — only its text / SO / remark
 * may change). A new entry, or an edit of the LAST one, must start at the
 * day's nextStart from the OTHER lines: 09:00 on an empty day, else the
 * latest Stop — and nothing else may be Open.
 */
function checkOrder(
  others: readonly DayLine[],
  self: DayLine | null,
  cand: EntryCandidate,
): 'fixed' | 'last' {
  if (self?.fromTime && lastEntryOf([...others, self])?.id !== self.id) {
    if (cand.fromTime !== self.fromTime || cand.toTime !== self.toTime || cand.kind !== self.kind) {
      throw new ValidationError(
        "Only the last entry's time can change — remove later entries first",
      );
    }
    return 'fixed';
  }
  const open = others.find((l) => l.fromTime && !l.toTime);
  if (open) {
    throw new ConflictError(`Stop ${open.description} (since ${fmt12(open.fromTime)}) first`);
  }
  const next = summarizeDay(spansOf(others)).nextStart ?? DAY_LOG_RULES.workFrom;
  // The last entry keeping its own Start (a Stop / text / SO / remark edit)
  // is not a new placement — only a moved Start must meet nextStart.
  const keepsStart = self?.fromTime === cand.fromTime && self?.kind === cand.kind;
  if (!keepsStart && cand.fromTime !== next) {
    throw new ValidationError(
      others.some((l) => l.fromTime)
        ? `Start must be ${fmt12(next)} — where your last entry ended`
        : `A day starts at ${fmt12(DAY_LOG_RULES.workFrom)}`,
    );
  }
  return 'last';
}

/**
 * OTHERS (kind 'leave'; owner 2026-10-27): late coming / half day / full day /
 * permission / personal. The description IS the reason; no SO / JWSO; never
 * Open; the user sets its Stop, at most the end of the work window — it may
 * lie after now (its Start may not: validateEntry). Strict order like any
 * entry, and entries may follow it once their time has come.
 */
function checkOthers(cand: EntryCandidate): void {
  if (!(DAY_LOG_OTHERS_REASONS as readonly string[]).includes(cand.description)) {
    throw new ValidationError('Pick the reason (Late coming, Half day…)');
  }
  if (cand.hasOrder) throw new ValidationError('Others cannot be for an SO / JWSO');
  const dayStart = DAY_LOG_RULES.workFrom;
  const dayEnd = DAY_LOG_RULES.workTo;
  if (!cand.toTime) {
    throw new ValidationError(`Give the Stop time — ${fmt12(dayEnd)} for the rest of the day`);
  }
  if (hhmmToMin(cand.toTime) > hhmmToMin(dayEnd)) {
    throw new ValidationError(`Others must stop by ${fmt12(dayEnd)}`);
  }
  // Reason-specific shape (owner 2026-10-27 audit).
  const r = cand.description;
  if (r === 'Late coming' && cand.fromTime !== dayStart) {
    throw new ValidationError(`Late coming is the day's first row, from ${fmt12(dayStart)}`);
  }
  if (r === 'Full day' && (cand.fromTime !== dayStart || cand.toTime !== dayEnd)) {
    throw new ValidationError(
      `Full day runs ${fmt12(dayStart)} – ${fmt12(dayEnd)} — use Half day or Permission for part of a day`,
    );
  }
  if (r === 'Half day' && cand.fromTime !== dayStart && cand.toTime !== dayEnd) {
    throw new ValidationError(
      `Half day is the morning (from ${fmt12(dayStart)}) or the afternoon (to ${fmt12(dayEnd)}) — use Permission for a gap in the day`,
    );
  }
}

/** The field rules the shared schema also states — re-checked here because
 *  the sheet rows (and tests) reach validateEntry without them. */
function checkFields(cand: EntryCandidate): void {
  if (cand.kind === 'work' && !cand.description) {
    throw new ValidationError('Write what you worked on');
  }
  if (cand.toTime && hhmmToMin(cand.toTime) <= hhmmToMin(cand.fromTime)) {
    throw new ValidationError('Stop time must be after Start time');
  }
  if (cand.kind !== 'break' && cand.toTime && !(cand.remarks ?? '').trim()) {
    throw new ValidationError('Remark is compulsory when Start and Stop are filled');
  }
}

/**
 * Every rule of one entry, checked under the day lock against the day's
 * OTHER live lines (`others` excludes `self`, the entry being edited).
 */
export async function validateEntry(
  tx: DbTransaction,
  companyId: string,
  h: DayHeader,
  others: readonly DayLine[],
  cand: EntryCandidate,
  self: DayLine | null,
  clock: DayLogClock,
): Promise<void> {
  const isToday = h.date === clock.today;
  const nowMin = isToday ? clock.nowMin : undefined;
  const nowHm = fmt12(minToHhmm(clock.nowMin));
  if (h.date > clock.today) throw new ValidationError(`${dmy(h.date)} has not come yet`);
  if (cand.kind === 'break' && cand.hasOrder) {
    throw new ValidationError('A break cannot be for an SO / JWSO');
  }
  checkFields(cand);
  if (cand.kind === 'leave') checkOthers(cand);
  // The order check — inside the day lock, against lines re-read under it (§20.3).
  if (checkOrder(others, self, cand) === 'fixed') return; // times unchanged: nothing more to judge
  if (isToday && hhmmToMin(cand.fromTime) > clock.nowMin) {
    throw new ValidationError(`Start ${fmt12(cand.fromTime)} is later than now (${nowHm})`);
  }
  // Others may be entered before its Stop comes; its Start may not.
  if (isToday && cand.kind !== 'leave' && cand.toTime && hhmmToMin(cand.toTime) > clock.nowMin) {
    throw new ValidationError(`Stop ${fmt12(cand.toTime)} is later than now (${nowHm})`);
  }
  if (!isToday && !cand.toTime) {
    throw new ValidationError(`Give a Stop time — ${dmy(h.date)} is over`);
  }
  if (!cand.toTime) {
    const open = await openElsewhere(tx, companyId, h.userId, self?.id ?? null);
    if (open) {
      const where = open.date === h.date ? '' : ` on ${dmy(open.date)}`;
      throw new ConflictError(
        `Your entry${where} since ${fmt12(open.fromTime)} is still Open — stop it first`,
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
      `Overlaps ${fmt12(hit.fromTime)} – ${hit.toTime ? fmt12(hit.toTime) : 'now'} ${hit.description} — entries cannot share time`,
    );
  }
  if (cand.kind === 'break') {
    const problem = breakLimitProblem(breakTotalWith(spansOf(others), cand, nowMin));
    if (problem) throw new ValidationError(problem);
  }
}
