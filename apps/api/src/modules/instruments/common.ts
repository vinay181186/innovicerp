// Instrument register — helpers shared with the Tool Issue module
// (ADR-193 phase 4): dates in IST, and the FOR UPDATE lock on register rows.

import type { InstrumentStatus } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { AuthorizationError, NotFoundError } from '../../lib/errors';

export function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

/** Today in IST (a record keyed at 01:00 IST belongs to today). */
export function todayIst(): string {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

/** ISO date + n days (calendar arithmetic in UTC, no time-zone drift). */
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export const dateOut = (v: unknown): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);

export const tsOut = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : String(v ?? '');

export interface LockedInstrument {
  id: string;
  itemId: string;
  serialNo: string;
  status: InstrumentStatus;
  calibrationIntervalDays: number | null;
  calibrationDueOn: string | null;
  /** A Scrap / Damaged / Lost write-off waits for a decision (P43). */
  writeoffPending: boolean;
  /** The latest calibration was a Fail (P41 — blocked until a Pass or a Scrap). */
  lastCalibrationFailed: boolean;
}

/**
 * Lock register rows FOR UPDATE in id order (P42 — two users picking the same
 * instrument: the second waits, then sees it Issued). Every id must exist in
 * this company, else 404.
 */
export async function lockInstruments(
  tx: DbTransaction,
  companyId: string,
  ids: string[],
): Promise<LockedInstrument[]> {
  if (ids.length === 0) return [];
  const sorted = [...new Set(ids)].sort();
  // 1) Take the row locks (id order). 2) Read everything the checks use in a
  // SEPARATE statement: under READ COMMITTED a waiter's subqueries in the
  // locking statement would still see the pre-lock snapshot (e.g. a Scrap
  // write-off committed while it waited), so the flags must be re-read.
  const lockedIds = (await tx.execute(sql`
    SELECT ins.id FROM public.instruments ins
    WHERE ins.company_id = ${companyId}::uuid AND ins.deleted_at IS NULL
      AND ins.id = ANY(${sql.param(sorted)}::uuid[])
    ORDER BY ins.id
    FOR UPDATE OF ins
  `)) as unknown as Array<{ id: string }>;
  if (lockedIds.length !== sorted.length) {
    throw new NotFoundError('An instrument was not found. Refresh the page and pick it again.');
  }
  const rows = (await tx.execute(sql`
    SELECT ins.id, ins.item_id, ins.serial_no, ins.status,
           ins.calibration_interval_days, ins.calibration_due_on,
           EXISTS (
             SELECT 1 FROM public.tool_writeoffs w
             WHERE w.instrument_id = ins.id AND w.status = 'pending' AND w.deleted_at IS NULL
           ) AS writeoff_pending,
           (
             SELECT c.result FROM public.instrument_calibrations c
             WHERE c.instrument_id = ins.id AND c.deleted_at IS NULL
             ORDER BY c.calibrated_on DESC, c.created_at DESC
             LIMIT 1
           ) = 'fail' AS last_calibration_failed
    FROM public.instruments ins
    WHERE ins.company_id = ${companyId}::uuid AND ins.deleted_at IS NULL
      AND ins.id = ANY(${sql.param(sorted)}::uuid[])
    ORDER BY ins.id
  `)) as unknown as Array<Record<string, unknown>>;
  if (rows.length !== sorted.length) {
    throw new NotFoundError('An instrument was not found. Refresh the page and pick it again.');
  }
  return rows.map((r) => ({
    id: String(r['id']),
    itemId: String(r['item_id']),
    serialNo: String(r['serial_no']),
    status: r['status'] as InstrumentStatus,
    calibrationIntervalDays:
      r['calibration_interval_days'] == null ? null : Number(r['calibration_interval_days']),
    calibrationDueOn: dateOut(r['calibration_due_on']),
    writeoffPending: Boolean(r['writeoff_pending']),
    lastCalibrationFailed: Boolean(r['last_calibration_failed']),
  }));
}

export async function lockInstrument(
  tx: DbTransaction,
  companyId: string,
  id: string,
): Promise<LockedInstrument> {
  return (await lockInstruments(tx, companyId, [id]))[0]!;
}

/** Set one or more instruments' status (caller holds the lock). */
export async function setInstrumentStatus(
  tx: DbTransaction,
  ids: string[],
  status: InstrumentStatus,
  userId: string,
): Promise<void> {
  if (ids.length === 0) return;
  await tx.execute(sql`
    UPDATE public.instruments
    SET status = ${status}, updated_at = now(), updated_by = ${userId}::uuid
    WHERE id = ANY(${sql.param(ids)}::uuid[])
  `);
}
