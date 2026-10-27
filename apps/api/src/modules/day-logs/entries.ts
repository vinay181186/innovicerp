// Day Log — the owner's entries: add, edit, Stop and remove (design approved
// 2026-10-26). STRICT ORDER (owner 2026-10-26): a new entry starts where the
// last one ended (09:00 first); only the LAST entry may change its times or
// be removed (validateEntry / deleteEntry); until the day is submitted; no
// approval. Each runs in ONE transaction under the day header lock (lock.ts)
// with the day re-read inside it in one statement (§20.3). The
// edit is `WHERE updated_at = <loaded>` (§20.4); Stop / remove are
// conditional on the row still being Open / live (§20.2). Round trips per
// write: BEGIN, lock, snapshot, line write + header bump, activity, COMMIT.

import {
  type AddDayLogEntryInput,
  type DayLogDetail,
  type StopDayLogEntryInput,
  type UpdateDayLogEntryInput,
  fmt12,
  hhmmToMin,
  minToHhmm,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { AuthContext } from '../../db/with-user-context';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { assertCanWrite, resolveAccess, viewerOf } from './access';
import { spansOf } from './day';
import { notOpenError } from './detail';
import {
  guardUnique,
  insertSql,
  label,
  lineOf,
  log,
  nextLineNo,
  ordersOf,
  prepare,
  returning,
  writeLines,
} from './entry-write';
import { dayTx, lockEntryDay, openDayLocked, requireHeader } from './lock';
import {
  type DayLogClock,
  breakLimitProblem,
  breakTotalWith,
  dmy,
  istClock,
  lastEntryOf,
} from './rules';
import { readSnapshot } from './snapshot';
import {
  guardOwnerWrite,
  hoursOf,
  ownerDetailAfter,
  requireCompany,
  staleEntryError,
} from './writes';

export async function addEntry(
  input: AddDayLogEntryInput,
  user: AuthContext,
  clock: DayLogClock = istClock(), // tests only — routes never pass it
): Promise<DayLogDetail> {
  const companyId = requireCompany(user);
  return guardUnique(() =>
    dayTx(async (tx) => {
      // The day lock (§20.3): every write on this day queues here.
      const locked = await openDayLocked(tx, user, companyId, input.date);
      const eff = await resolveAccess(user, locked.access);
      assertCanWrite(eff);
      if (input.date > clock.today)
        throw new ValidationError(`${dmy(input.date)} has not come yet`);
      const h = locked.header;
      const snap = await readSnapshot(
        { companyId, viewerId: null, targetId: user.id, date: h.date, orders: ordersOf([input]) },
        tx,
      );
      guardOwnerWrite(h, snap, clock.today);
      const r = prepare(h, snap.lines, input, null, clock, snap);
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
    }),
  );
}

export async function updateEntry(
  entryId: string,
  input: UpdateDayLogEntryInput,
  user: AuthContext,
  clock: DayLogClock = istClock(),
): Promise<DayLogDetail> {
  const companyId = requireCompany(user);
  return guardUnique(() =>
    dayTx(async (tx) => {
      const locked = await lockEntryDay(tx, user, companyId, entryId);
      const eff = await resolveAccess(user, locked.access);
      assertCanWrite(eff);
      const h = requireHeader(locked);
      const snap = await readSnapshot(
        { companyId, viewerId: null, targetId: user.id, date: h.date, orders: ordersOf([input]) },
        tx,
      );
      guardOwnerWrite(h, snap, clock.today);
      const self = snap.lines.find((l) => l.id === entryId);
      if (!self) throw new NotFoundError('Entry not found');
      if (new Date(self.updatedAt).getTime() !== new Date(input.updatedAt).getTime()) {
        throw staleEntryError(self.updatedAt);
      }
      const r = prepare(h, snap.lines, input, self, clock, snap);
      // §20.4 — write only over what was loaded.
      const [w] = await writeLines(
        tx,
        h,
        user,
        sql`
        UPDATE public.daily_report_lines
        SET kind = ${r.kind}, description = ${r.description}, from_time = ${r.fromTime}::time,
            to_time = ${r.toTime}::time, status = ${r.toTime ? 'completed' : 'in_progress'},
            hours = ${hoursOf(r.fromTime, r.toTime)}, remarks = ${r.remarks},
            sales_order_id = ${r.soId}::uuid, job_work_order_id = ${r.jwId}::uuid,
            updated_at = now(), updated_by = ${user.id}::uuid
        WHERE id = ${entryId}::uuid AND deleted_at IS NULL
          AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', ${input.updatedAt}::timestamptz)
        RETURNING ${returning(h)}`,
      );
      if (!w) throw staleEntryError(self.updatedAt);
      await log(
        tx,
        companyId,
        user,
        h,
        'UPDATE',
        `changed ${label({ fromTime: self.fromTime ?? '', toTime: self.toTime, description: self.description })} to ${label(r)}`,
      );
      const lines = snap.lines.map((l) => (l.id === entryId ? lineOf(r, w, h.id) : l));
      return ownerDetailAfter(snap, h, lines, viewerOf(user, eff), clock);
    }),
  );
}

/** Stop an Open entry at now (today). Started this very minute = it never
 *  ran (the CHECK refuses a 0-minute line), so it is removed. */
export async function stopEntry(
  entryId: string,
  input: StopDayLogEntryInput,
  user: AuthContext,
  clock: DayLogClock = istClock(),
): Promise<DayLogDetail> {
  const companyId = requireCompany(user);
  return dayTx(async (tx) => {
    const locked = await lockEntryDay(tx, user, companyId, entryId);
    const eff = await resolveAccess(user, locked.access);
    assertCanWrite(eff);
    const h = requireHeader(locked);
    if (h.status !== 'open') throw notOpenError(h);
    const snap = await readSnapshot(
      { companyId, viewerId: null, targetId: user.id, date: h.date },
      tx,
    );
    const self = snap.lines.find((l) => l.id === entryId);
    if (!self || !self.fromTime) throw new NotFoundError('Entry not found');
    if (self.toTime)
      throw new ConflictError(`This entry was already stopped at ${fmt12(self.toTime)} — reload`);
    if (h.date !== clock.today) {
      throw new ValidationError(`Edit the entry and give the time you stopped on ${dmy(h.date)}`);
    }
    const nowHm = minToHhmm(clock.nowMin);
    const removed = clock.nowMin <= hhmmToMin(self.fromTime);
    // The remark is compulsory on a stopped Work entry (kept if it has one).
    const remarks = input.remarks?.trim() || self.remarks?.trim() || null;
    if (!removed && self.kind !== 'break' && !remarks) {
      throw new ValidationError('Remark is compulsory when you stop');
    }
    if (!removed && self.kind === 'break') {
      const problem = breakLimitProblem(
        breakTotalWith(
          spansOf(snap.lines.filter((l) => l.id !== entryId)),
          { kind: 'break', fromTime: self.fromTime, toTime: nowHm },
          clock.nowMin,
        ),
      );
      if (problem)
        throw new ValidationError(`${problem} — Edit the break and give an earlier Stop time`);
    }
    const [w] = await writeLines(
      tx,
      h,
      user,
      removed
        ? sql`
          UPDATE public.daily_report_lines
          SET deleted_at = now(), deleted_by = ${user.id}::uuid, updated_at = now(), updated_by = ${user.id}::uuid
          WHERE id = ${entryId}::uuid AND to_time IS NULL AND deleted_at IS NULL
          RETURNING ${returning(h)}`
        : sql`
          UPDATE public.daily_report_lines
          SET to_time = ${nowHm}::time, status = 'completed', hours = ${hoursOf(self.fromTime, nowHm)},
              remarks = ${remarks}, updated_at = now(), updated_by = ${user.id}::uuid
          WHERE id = ${entryId}::uuid AND to_time IS NULL AND deleted_at IS NULL
          RETURNING ${returning(h)}`,
    );
    if (!w) throw new ConflictError('This entry was already stopped — reload');
    await log(
      tx,
      companyId,
      user,
      h,
      'STOP',
      removed
        ? `removed ${label({ fromTime: self.fromTime, toTime: null, description: self.description })} (stopped the minute it started)`
        : `stopped ${fmt12(self.fromTime)}–${fmt12(nowHm)} ${self.description}`,
    );
    const lines = removed
      ? snap.lines.filter((l) => l.id !== entryId)
      : snap.lines.map((l) =>
          l.id === entryId
            ? { ...l, toTime: nowHm, remarks, updatedAt: w.updatedAt, late: w.late }
            : l,
        );
    return ownerDetailAfter(snap, h, lines, viewerOf(user, eff), clock);
  });
}

/** Remove the LAST entry of an open day (strict order; soft delete). */
export async function deleteEntry(
  entryId: string,
  user: AuthContext,
  clock: DayLogClock = istClock(),
): Promise<DayLogDetail> {
  const companyId = requireCompany(user);
  return dayTx(async (tx) => {
    const locked = await lockEntryDay(tx, user, companyId, entryId);
    const eff = await resolveAccess(user, locked.access);
    assertCanWrite(eff);
    const h = requireHeader(locked);
    // Re-read under the day lock (§20.3).
    const snap = await readSnapshot(
      { companyId, viewerId: null, targetId: user.id, date: h.date },
      tx,
    );
    guardOwnerWrite(h, snap, clock.today);
    const self = snap.lines.find((l) => l.id === entryId);
    if (!self) throw new NotFoundError('Entry not found');
    if (self.fromTime && lastEntryOf(snap.lines)?.id !== self.id) {
      throw new ValidationError('Remove the later entries first');
    }
    const [w] = await writeLines(
      tx,
      h,
      user,
      sql`
      UPDATE public.daily_report_lines
      SET deleted_at = now(), deleted_by = ${user.id}::uuid, updated_at = now(), updated_by = ${user.id}::uuid
      WHERE id = ${entryId}::uuid AND deleted_at IS NULL
      RETURNING ${returning(h)}`,
    );
    if (!w) throw new ConflictError('This entry was already removed — reload');
    await log(
      tx,
      companyId,
      user,
      h,
      'DELETE',
      `removed ${label({ fromTime: self.fromTime ?? '', toTime: self.toTime, description: self.description })}`,
    );
    const lines = snap.lines.filter((l) => l.id !== entryId);
    return ownerDetailAfter(snap, h, lines, viewerOf(user, eff), clock);
  });
}
