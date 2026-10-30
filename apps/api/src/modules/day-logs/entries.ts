// Day Log — the owner's rows (simple sheet, owner 2026-10-27): add one row,
// and edit a saved row. A saved row is never removed. Its Start / Stop / SO
// edit is saved DIRECTLY (ADR-256, owner 2026-10-30) and adds an Entry Rev
// (the whole line after it) for the Super Admin; an edit staged before
// ADR-256 (pending_*) is still decided on Approvals (approvals.ts) and blocks
// a new edit until then. Working On is NOT part of this edit (ADR-255): it
// changes directly through text.ts, and this path never changes it. Each runs
// in ONE transaction under the day header lock (lock.ts) with the day re-read
// inside it in one statement (§20.3).
// Round trips per write: BEGIN, lock, snapshot, line write (+ Entry Rev) + header bump,
// activity, COMMIT.

import {
  type AddDayLogEntryInput,
  type DayLogDetail,
  type UpdateDayLogEntryInput,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { AuthContext } from '../../db/with-user-context';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { assertCanWrite, resolveAccess, viewerOf } from './access';
import {
  REV_COLS,
  insertSql,
  label,
  lineOf,
  log,
  nextLineNo,
  orderOfRow,
  ordersOf,
  prepare,
  returning,
  revisionAfter,
  spanLabel,
  writeLines,
} from './entry-write';
import { dayTx, lockEntryDay, openDayLocked, requireHeader } from './lock';
import { type DayLogClock, dmy, istClock } from './rules';
import { readSnapshot } from './snapshot';
import {
  guardOwnerWrite,
  hoursOf,
  ownerDetailAfter,
  requireCompany,
  staleEntryError,
} from './writes';

// Still used: an edit staged before ADR-256 blocks a new one until decided.
export const PENDING_ERROR = 'An edit is already waiting for approval';

export async function addEntry(
  input: AddDayLogEntryInput,
  user: AuthContext,
  clock: DayLogClock = istClock(), // tests only — routes never pass it
): Promise<DayLogDetail> {
  const companyId = requireCompany(user);
  return dayTx(async (tx) => {
    // The day lock (§20.3): every write on this day queues here.
    const locked = await openDayLocked(tx, user, companyId, input.date);
    const eff = await resolveAccess(user, locked.access);
    assertCanWrite(eff);
    if (input.date > clock.today) throw new ValidationError(`${dmy(input.date)} has not come yet`);
    const h = locked.header;
    const snap = await readSnapshot(
      {
        companyId,
        viewerId: null,
        targetId: user.id,
        date: h.date,
        replies: true,
        orders: ordersOf([input]),
      },
      tx,
    );
    guardOwnerWrite(h.date, snap, clock.today);
    const r = prepare(h.date, snap.lines, input, null, clock, snap);
    const [w] = await writeLines(
      tx,
      h,
      user,
      insertSql(companyId, h, user, [r], nextLineNo(snap.lines)),
      revisionAfter(user.id), // ADR-255/256 — Entry Rev 0, same statement
    );
    await log(
      tx,
      companyId,
      user,
      h,
      'CREATE',
      `added ${label(r)}${r.orderCode ? ` (${r.orderCode})` : ''}`,
    );
    const lines = [...snap.lines, lineOf(r, w!, h.id)];
    return ownerDetailAfter(snap, h, lines, viewerOf(user, eff), clock);
  });
}

/**
 * ✎ an edit of a saved row → saved DIRECTLY (ADR-256, owner 2026-10-30).
 * The new values are checked exactly like a new row, against the OTHER rows'
 * current values, then written to the live columns; reject_reason is
 * cleared. The SAME statement adds Entry Rev max+1 — the whole line after
 * the edit (revisionAfter) — for the Super Admin's Team Day Logs. An edit
 * still waiting from before ADR-256 (pending_at set) blocks with
 * PENDING_ERROR until it is decided. ADR-255:
 * the input description is IGNORED, and no Working On text reaches
 * activity_log.
 */
export async function updateEntry(
  entryId: string,
  input: UpdateDayLogEntryInput,
  user: AuthContext,
  clock: DayLogClock = istClock(),
): Promise<DayLogDetail> {
  const companyId = requireCompany(user);
  return dayTx(async (tx) => {
    const locked = await lockEntryDay(tx, user, companyId, entryId);
    const eff = await resolveAccess(user, locked.access);
    assertCanWrite(eff);
    const h = requireHeader(locked);
    const snap = await readSnapshot(
      {
        companyId,
        viewerId: null,
        targetId: user.id,
        date: h.date,
        replies: true,
        orders: ordersOf([input]),
      },
      tx,
    );
    guardOwnerWrite(h.date, snap, clock.today);
    const self = snap.lines.find((l) => l.id === entryId);
    if (!self || !self.fromTime) throw new NotFoundError('Entry not found');
    // Old Break / Others (leave) rows keep their times (same rule as text.ts).
    if (self.kind !== 'work') throw new ValidationError('This row cannot be edited');
    if (self.pending) throw new ConflictError(PENDING_ERROR);
    if (new Date(self.updatedAt).getTime() !== new Date(input.updatedAt).getTime()) {
      throw staleEntryError(self.updatedAt);
    }
    const others = snap.lines.filter((l) => l.id !== entryId);
    // ADR-255 — the live Working On, never the sent one.
    const r = prepare(
      h.date,
      others,
      { ...input, description: self.description },
      self,
      clock,
      snap,
    );
    const same =
      r.fromTime === self.fromTime &&
      r.toTime === self.toTime &&
      (r.soId ?? r.jwId) === (self.order?.id ?? null);
    if (same) throw new ValidationError('Nothing changed');
    // §20.4 — only over what was loaded, and only when nothing waits from before.
    const [w] = await writeLines(
      tx,
      h,
      user,
      sql`
      UPDATE public.daily_report_lines
      SET from_time = ${r.fromTime}::time, to_time = ${r.toTime}::time,
          sales_order_id = ${r.soId}::uuid, job_work_order_id = ${r.jwId}::uuid,
          kind = 'work', status = 'completed', hours = ${hoursOf(r.fromTime, r.toTime)},
          reject_reason = NULL, updated_at = now(), updated_by = ${user.id}::uuid
      WHERE id = ${entryId}::uuid AND deleted_at IS NULL AND pending_at IS NULL
        AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', ${input.updatedAt}::timestamptz)
      RETURNING ${returning(h)}, ${REV_COLS}`,
      // ADR-256 — the Entry Rev, same statement.
      revisionAfter(user.id, {
        description: self.description,
        fromTime: self.fromTime,
        toTime: self.toTime,
        order: self.order,
      }),
    );
    if (!w) throw new ConflictError(`${PENDING_ERROR}, or the entry changed — reload`);
    await log(
      tx,
      companyId,
      user,
      h,
      'EDIT',
      `changed ${spanLabel({ fromTime: self.fromTime, toTime: self.toTime }, self.order?.code ?? null)} to ${spanLabel(r, r.orderCode)}`,
    );
    const lines = snap.lines.map((l) =>
      l.id === entryId
        ? {
            ...l,
            kind: 'work' as const,
            fromTime: r.fromTime,
            toTime: r.toTime,
            order: orderOfRow(r),
            late: w.late,
            updatedAt: w.updatedAt,
            rejectReason: null,
            pending: null,
          }
        : l,
    );
    return ownerDetailAfter(snap, h, lines, viewerOf(user, eff), clock);
  });
}
