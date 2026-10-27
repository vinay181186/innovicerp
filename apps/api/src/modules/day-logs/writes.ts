// Day Log — what every write shares: the guards and the ONE validation of a
// row (new rows, the sheet batch, an edit request and its approval all use
// validateEntry). Every write: lock the day header (lock.ts — the same
// statement reads the access, checked first: assertCanWrite, no page tick —
// ADR-232) → read the day's snapshot INSIDE that lock → validate in memory →
// write → bump the header (§20.3). `hours` is written only from From/To (§20.1).

import { type DayLogDetail, fmt12, hhmmToMin, minToHhmm } from '@innovic/shared';
import type { AuthContext } from '../../db/with-user-context';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import type { Viewer } from './access';
import { type DayHeader, type DayLine, inTimeOrder } from './day';
import { blockedByOf, detailOf } from './detail';
import { type DayLogClock, dmy, findOverlap, istHm } from './rules';
import type { DaySnapshot } from './snapshot';

export const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

/** `hours` of a line: From–To in hours. */
export const hoursOf = (fromTime: string, toTime: string | null): string =>
  toTime ? ((hhmmToMin(toTime) - hhmmToMin(fromTime)) / 60).toFixed(2) : '0';

/** The owner's own write on `date`: not in the future, and yesterday first
 *  — judged on the snapshot read under the day lock. */
export function guardOwnerWrite(date: string, snap: DaySnapshot, today: string): void {
  if (date > today) throw new ValidationError(`${dmy(date)} has not come yet`);
  const blocked = blockedByOf(snap, date);
  if (blocked) throw new ConflictError(blocked.reason);
}

/**
 * The owner's DayLogDetail after a write, built in memory from the snapshot
 * read under the lock plus what the write returned: `lines` are the day's
 * lines after it. Yesterday-first looks only at earlier days, so a write on
 * this day never changes it.
 */
export function ownerDetailAfter(
  snap: DaySnapshot,
  h: DayHeader,
  lines: readonly DayLine[],
  v: Viewer,
  clock: DayLogClock,
): DayLogDetail {
  if (!snap.target) throw new NotFoundError('User not found');
  return detailOf(
    { header: h, lines: inTimeOrder(lines), holidays: snap.holidays },
    blockedByOf(snap, h.date),
    v,
    snap.target,
    h.date,
    clock,
  );
}

/** 409 for an edit whose loaded updatedAt is no longer the entry's (§20.4). */
export function staleEntryError(currentUpdatedAt: string): ConflictError {
  return new ConflictError(
    `This entry was changed at ${fmt12(istHm(currentUpdatedAt))} — reload and redo your change`,
  );
}

export interface EntryCandidate {
  fromTime: string;
  toTime: string;
  description: string;
}

/**
 * Every rule of one row on day `date`, against the day's OTHER rows
 * (`others` excludes the row being edited; their CURRENT values): Working on
 * written, Stop after Start, not in the future, Stop not after now on today,
 * no shared minute with another row. The schema states the field rules too;
 * they are re-checked because the batch and approval reach here without it.
 */
export function validateEntry(
  date: string,
  others: readonly DayLine[],
  cand: EntryCandidate,
  clock: DayLogClock,
): void {
  if (date > clock.today) throw new ValidationError(`${dmy(date)} has not come yet`);
  if (!cand.description.trim()) throw new ValidationError('Write what you worked on');
  if (hhmmToMin(cand.toTime) <= hhmmToMin(cand.fromTime)) {
    throw new ValidationError('Stop time must be after Start time');
  }
  if (date === clock.today && hhmmToMin(cand.toTime) > clock.nowMin) {
    throw new ValidationError(
      `Stop ${fmt12(cand.toTime)} is later than now (${fmt12(minToHhmm(clock.nowMin))})`,
    );
  }
  const nowMin = date === clock.today ? clock.nowMin : undefined;
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
      `Overlaps ${fmt12(hit.fromTime)} – ${hit.toTime ? fmt12(hit.toTime) : 'now'} ${hit.description} — rows cannot share time`,
    );
  }
}
