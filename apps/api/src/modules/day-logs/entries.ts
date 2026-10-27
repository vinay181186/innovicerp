// Day Log — the owner's rows (simple sheet, owner 2026-10-27): add one row,
// and ask for an edit of a saved row. A saved row is never removed and never
// changed directly: the edit is STAGED on it (pending_*) until an approver
// decides (approvals.ts). Each runs in ONE transaction under the day header
// lock (lock.ts) with the day re-read inside it in one statement (§20.3).
// Round trips per write: BEGIN, lock, snapshot, line write + header bump,
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
  insertSql,
  label,
  lineOf,
  log,
  nextLineNo,
  orderOfRow,
  ordersOf,
  prepare,
  returning,
  writeLines,
} from './entry-write';
import { dayTx, lockEntryDay, openDayLocked, requireHeader } from './lock';
import { type DayLogClock, dmy, istClock } from './rules';
import { readSnapshot } from './snapshot';
import { guardOwnerWrite, ownerDetailAfter, requireCompany, staleEntryError } from './writes';

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
      { companyId, viewerId: null, targetId: user.id, date: h.date, orders: ordersOf([input]) },
      tx,
    );
    guardOwnerWrite(h.date, snap, clock.today);
    const r = prepare(h.date, snap.lines, input, null, clock, snap);
    const [w] = await writeLines(
      tx,
      h,
      user,
      insertSql(companyId, h, user, [r], nextLineNo(snap.lines)),
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
 * ✎ an edit of a saved row → staged for approval. The proposed values are
 * checked exactly like a new row, against the OTHER rows' current values.
 * The live values do not change; reject_reason is cleared.
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
      { companyId, viewerId: null, targetId: user.id, date: h.date, orders: ordersOf([input]) },
      tx,
    );
    guardOwnerWrite(h.date, snap, clock.today);
    const self = snap.lines.find((l) => l.id === entryId);
    if (!self || !self.fromTime) throw new NotFoundError('Entry not found');
    if (self.pending) throw new ConflictError(PENDING_ERROR);
    if (new Date(self.updatedAt).getTime() !== new Date(input.updatedAt).getTime()) {
      throw staleEntryError(self.updatedAt);
    }
    const others = snap.lines.filter((l) => l.id !== entryId);
    const r = prepare(h.date, others, input, self, clock, snap);
    const same =
      r.fromTime === self.fromTime &&
      r.toTime === self.toTime &&
      r.description === self.description &&
      (r.soId ?? r.jwId) === (self.order?.id ?? null);
    if (same) throw new ValidationError('Nothing changed');
    // §20.4 — only over what was loaded, and only when nothing is waiting.
    const [w] = await writeLines(
      tx,
      h,
      user,
      sql`
      UPDATE public.daily_report_lines
      SET pending_from = ${r.fromTime}::time, pending_to = ${r.toTime}::time,
          pending_description = ${r.description},
          pending_sales_order_id = ${r.soId}::uuid, pending_job_work_order_id = ${r.jwId}::uuid,
          pending_at = now(), pending_by = ${user.id}::uuid, reject_reason = NULL,
          updated_at = now(), updated_by = ${user.id}::uuid
      WHERE id = ${entryId}::uuid AND deleted_at IS NULL AND pending_at IS NULL
        AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', ${input.updatedAt}::timestamptz)
      RETURNING ${returning(h)}`,
    );
    if (!w) throw new ConflictError(`${PENDING_ERROR}, or the entry changed — reload`);
    await log(
      tx,
      companyId,
      user,
      h,
      'EDIT_REQUEST',
      `asked to change ${label({ fromTime: self.fromTime, toTime: self.toTime, description: self.description })} to ${label(r)}`,
    );
    const lines = snap.lines.map((l) =>
      l.id === entryId
        ? {
            ...l,
            updatedAt: w.updatedAt,
            rejectReason: null,
            pending: {
              fromTime: r.fromTime,
              toTime: r.toTime,
              description: r.description,
              order: orderOfRow(r),
              // pending_at and updated_at are both now() — the same instant.
              requestedAt: w.updatedAt,
            },
          }
        : l,
    );
    return ownerDetailAfter(snap, h, lines, viewerOf(user, eff), clock);
  });
}
