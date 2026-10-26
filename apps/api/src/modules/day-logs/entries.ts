// Day Log — the owner's entries: add, edit, Stop and remove (design approved
// 2026-10-26). Any entry, in any order, until the day is submitted; no
// approval. Each runs in ONE transaction under the day header lock (openDay /
// lockHeaderById, FOR UPDATE) with the lines re-read inside it (§20.3). The
// edit is `WHERE updated_at = <loaded>` (§20.4); Stop / remove are
// conditional on the row still being Open / live (§20.2).

import {
  type AddDayLogEntryInput,
  type DayLogDetail,
  type DayLogEntryKind,
  type DayLogOrderType,
  type UpdateDayLogEntryInput,
  hhmmToMin,
  minToHhmm,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireCanWrite } from '../../lib/access';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';
import { loadViewer } from './access';
import {
  type DayHeader,
  type DayLine,
  loadLines,
  nextLineNo,
  openDay,
  spansOf,
  touchDay,
} from './day';
import { notOpenError } from './detail';
import { requireOpenOrder } from './orders';
import { type DayLogClock, breakLimitProblem, breakTotalWith, dmy, istClock } from './rules';
import {
  guardOwnerWrite,
  hoursOf,
  lockOwnEntry,
  ownerDetail,
  requireCompany,
  staleEntryError,
  uniqueHit,
  validateEntry,
} from './writes';

type EntryFields = Omit<AddDayLogEntryInput, 'date'>;

/** The stored shape of one entry's fields. */
interface Row {
  kind: DayLogEntryKind;
  description: string;
  fromTime: string;
  toTime: string | null;
  remarks: string | null;
  soId: string | null;
  jwId: string | null;
  orderCode: string | null;
}

/** Validate the fields under the lock and resolve the order (409 unless it is
 *  open — an order the entry already had is kept even if it closed since). */
async function prepare(
  tx: DbTransaction,
  companyId: string,
  h: DayHeader,
  lines: readonly DayLine[],
  input: EntryFields,
  self: DayLine | null,
  clock: DayLogClock,
): Promise<Row> {
  const toTime = input.stopTime ?? null;
  const others = lines.filter((l) => l.id !== self?.id);
  const orderType: DayLogOrderType | null = input.orderType ?? null;
  const orderId = input.orderId ?? null;
  await validateEntry(
    tx,
    companyId,
    h,
    others,
    { kind: input.kind, fromTime: input.startTime, toTime, hasOrder: !!orderId },
    self?.id ?? null,
    clock,
  );
  let orderCode: string | null = null;
  if (orderType && orderId) {
    const kept = self?.order && self.order.type === orderType && self.order.id === orderId;
    orderCode = kept
      ? self.order!.code
      : (await requireOpenOrder(tx, companyId, orderType, orderId)).code;
  }
  return {
    kind: input.kind,
    description: input.description || (input.kind === 'break' ? 'Break' : ''),
    fromTime: input.startTime,
    toTime,
    remarks: input.remarks || null,
    soId: orderType === 'so' ? orderId : null,
    jwId: orderType === 'jwso' ? orderId : null,
    orderCode,
  };
}

const label = (r: { fromTime: string; toTime: string | null; description: string }): string =>
  `${r.fromTime}–${r.toTime ?? 'Open'} ${r.description}`;

async function log(
  tx: DbTransaction,
  companyId: string,
  user: AuthContext,
  h: DayHeader,
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'STOP',
  detail: string,
): Promise<void> {
  await emitActivityLog(
    tx,
    {
      action,
      entity: 'Day Log',
      entityId: h.id,
      refId: h.date,
      detail: `Day Log ${dmy(h.date)}: ${detail}`,
    },
    companyId,
    user,
  );
}

/** A second Open entry racing past the code check hits daily_report_lines_open_uq. */
async function guardUnique<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (uniqueHit(e)) throw new ConflictError('Another entry is already Open — reload');
    throw e;
  }
}

export async function addEntry(
  input: AddDayLogEntryInput,
  user: AuthContext,
  clock: DayLogClock = istClock(), // tests only — routes never pass it
): Promise<DayLogDetail> {
  await requireCanWrite(user);
  const v = await loadViewer(user); // before the tx (ADR-229)
  const companyId = requireCompany(user);
  if (input.date > clock.today) throw new ValidationError(`${dmy(input.date)} has not come yet`);
  return guardUnique(() =>
    withUserContext(user, async (tx) => {
      // The day lock (§20.3): every write on this day queues here.
      const h = await openDay(tx, companyId, user.id, input.date, user);
      await guardOwnerWrite(tx, companyId, h, clock.today);
      const lines = await loadLines(tx, companyId, h.id);
      const r = await prepare(tx, companyId, h, lines, input, null, clock);
      await tx.execute(sql`
        INSERT INTO public.daily_report_lines
          (company_id, daily_report_id, line_no, description, kind, from_time, to_time,
           status, hours, remarks, sales_order_id, job_work_order_id, created_by, updated_by)
        VALUES (${companyId}::uuid, ${h.id}::uuid, ${await nextLineNo(tx, h.id)}, ${r.description},
                ${r.kind}, ${r.fromTime}::time, ${r.toTime}::time,
                ${r.toTime ? 'completed' : 'in_progress'}, ${hoursOf(r.fromTime, r.toTime)},
                ${r.remarks}, ${r.soId}::uuid, ${r.jwId}::uuid, ${user.id}::uuid, ${user.id}::uuid)
      `);
      await touchDay(tx, h.id, user);
      await log(
        tx,
        companyId,
        user,
        h,
        'CREATE',
        `added ${label(r)}${r.orderCode ? ` (${r.orderCode})` : ''}`,
      );
      return ownerDetail(tx, companyId, v, user, h.date, clock);
    }),
  );
}

export async function updateEntry(
  entryId: string,
  input: UpdateDayLogEntryInput,
  user: AuthContext,
  clock: DayLogClock = istClock(),
): Promise<DayLogDetail> {
  await requireCanWrite(user);
  const v = await loadViewer(user); // before the tx (ADR-229)
  const companyId = requireCompany(user);
  return guardUnique(() =>
    withUserContext(user, async (tx) => {
      const h = await lockOwnEntry(tx, companyId, user, entryId);
      await guardOwnerWrite(tx, companyId, h, clock.today);
      const lines = await loadLines(tx, companyId, h.id);
      const self = lines.find((l) => l.id === entryId);
      if (!self) throw new NotFoundError('Entry not found');
      if (new Date(self.updatedAt).getTime() !== new Date(input.updatedAt).getTime()) {
        throw staleEntryError(self.updatedAt);
      }
      const r = await prepare(tx, companyId, h, lines, input, self, clock);
      // §20.4 — write only over what was loaded.
      const updated = (await tx.execute(sql`
        UPDATE public.daily_report_lines
        SET kind = ${r.kind}, description = ${r.description}, from_time = ${r.fromTime}::time,
            to_time = ${r.toTime}::time, status = ${r.toTime ? 'completed' : 'in_progress'},
            hours = ${hoursOf(r.fromTime, r.toTime)}, remarks = ${r.remarks},
            sales_order_id = ${r.soId}::uuid, job_work_order_id = ${r.jwId}::uuid,
            updated_at = now(), updated_by = ${user.id}::uuid
        WHERE id = ${entryId}::uuid AND deleted_at IS NULL
          AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', ${input.updatedAt}::timestamptz)
        RETURNING id
      `)) as unknown as unknown[];
      if (updated.length === 0) throw staleEntryError(self.updatedAt);
      await touchDay(tx, h.id, user);
      await log(
        tx,
        companyId,
        user,
        h,
        'UPDATE',
        `changed ${label({ fromTime: self.fromTime ?? '', toTime: self.toTime, description: self.description })} to ${label(r)}`,
      );
      return ownerDetail(tx, companyId, v, user, h.date, clock);
    }),
  );
}

/** Stop an Open entry at now (today). Started this very minute = it never
 *  ran (the CHECK refuses a 0-minute line), so it is removed. */
export async function stopEntry(
  entryId: string,
  user: AuthContext,
  clock: DayLogClock = istClock(),
): Promise<DayLogDetail> {
  await requireCanWrite(user);
  const v = await loadViewer(user); // before the tx (ADR-229)
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const h = await lockOwnEntry(tx, companyId, user, entryId);
    if (h.status !== 'open') throw notOpenError(h);
    const self = (await loadLines(tx, companyId, h.id)).find((l) => l.id === entryId);
    if (!self || !self.fromTime) throw new NotFoundError('Entry not found');
    if (self.toTime)
      throw new ConflictError(`This entry was already stopped at ${self.toTime} — reload`);
    if (h.date !== clock.today) {
      throw new ValidationError(`Edit the entry and give the time you stopped on ${dmy(h.date)}`);
    }
    const nowHm = minToHhmm(clock.nowMin);
    const removed = clock.nowMin <= hhmmToMin(self.fromTime);
    if (!removed && self.kind === 'break') {
      const lines = await loadLines(tx, companyId, h.id);
      const problem = breakLimitProblem(
        breakTotalWith(
          spansOf(lines.filter((l) => l.id !== entryId)),
          { kind: 'break', fromTime: self.fromTime, toTime: nowHm },
          clock.nowMin,
        ),
      );
      if (problem)
        throw new ValidationError(`${problem} — Edit the break and give an earlier Stop time`);
    }
    const done = (await tx.execute(
      removed
        ? sql`
          UPDATE public.daily_report_lines
          SET deleted_at = now(), deleted_by = ${user.id}::uuid, updated_at = now(), updated_by = ${user.id}::uuid
          WHERE id = ${entryId}::uuid AND to_time IS NULL AND deleted_at IS NULL
          RETURNING id`
        : sql`
          UPDATE public.daily_report_lines
          SET to_time = ${nowHm}::time, status = 'completed', hours = ${hoursOf(self.fromTime, nowHm)},
              updated_at = now(), updated_by = ${user.id}::uuid
          WHERE id = ${entryId}::uuid AND to_time IS NULL AND deleted_at IS NULL
          RETURNING id`,
    )) as unknown as unknown[];
    if (done.length === 0) throw new ConflictError('This entry was already stopped — reload');
    await touchDay(tx, h.id, user);
    await log(
      tx,
      companyId,
      user,
      h,
      'STOP',
      removed
        ? `removed ${label({ fromTime: self.fromTime, toTime: null, description: self.description })} (stopped the minute it started)`
        : `stopped ${self.fromTime}–${nowHm} ${self.description}`,
    );
    return ownerDetail(tx, companyId, v, user, h.date, clock);
  });
}

/** Remove any entry of an open day (soft delete). */
export async function deleteEntry(
  entryId: string,
  user: AuthContext,
  clock: DayLogClock = istClock(),
): Promise<DayLogDetail> {
  await requireCanWrite(user);
  const v = await loadViewer(user); // before the tx (ADR-229)
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const h = await lockOwnEntry(tx, companyId, user, entryId);
    await guardOwnerWrite(tx, companyId, h, clock.today);
    const self = (await loadLines(tx, companyId, h.id)).find((l) => l.id === entryId);
    if (!self) throw new NotFoundError('Entry not found');
    const gone = (await tx.execute(sql`
      UPDATE public.daily_report_lines
      SET deleted_at = now(), deleted_by = ${user.id}::uuid, updated_at = now(), updated_by = ${user.id}::uuid
      WHERE id = ${entryId}::uuid AND deleted_at IS NULL
      RETURNING id
    `)) as unknown as unknown[];
    if (gone.length === 0) throw new ConflictError('This entry was already removed — reload');
    await touchDay(tx, h.id, user);
    await log(
      tx,
      companyId,
      user,
      h,
      'DELETE',
      `removed ${label({ fromTime: self.fromTime ?? '', toTime: self.toTime, description: self.description })}`,
    );
    return ownerDetail(tx, companyId, v, user, h.date, clock);
  });
}
