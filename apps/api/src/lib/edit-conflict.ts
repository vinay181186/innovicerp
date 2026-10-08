// R5 — edit conflict (ERPNext "Document has been modified after you have
// opened it"). See packages/shared/src/lib/edit-conflict.ts.
//
// Call it INSIDE the update transaction, right after the row has been read
// with `.for('update')`, and before anything is written:
//
//   const cur = (await tx.select().from(t).where(eq(t.id, id)).for('update'))[0];
//   assertUnchangedSinceOpened(cur.updatedAt, input.expectedUpdatedAt);
//
// Holding the row lock makes the check-then-write atomic: a second editor
// waits on the lock, then sees the first editor's new updated_at and is
// refused. Every table checked here must bump updated_at on every UPDATE (the
// set_updated_at trigger — plans and bom_masters get theirs in 0187; their
// services also set it explicitly on edit).

import {
  EDIT_CONFLICT_CODE,
  EDIT_CONFLICT_MESSAGE,
  type EditConflictDetails,
} from '@innovic/shared';
import { AppError, ValidationError } from './errors';

/** Milliseconds since epoch for a Date, an ISO string, or Postgres' text form
 *  ("2026-09-30 10:15:02.123456+00"). Sub-millisecond digits are dropped on
 *  both sides — a JS Date only carries milliseconds. */
export function timestampMs(value: Date | string): number {
  if (value instanceof Date) return value.getTime();
  let s = value.trim().replace(' ', 'T');
  // Trim a fraction longer than 3 digits (microseconds) to milliseconds.
  s = s.replace(/(\.\d{3})\d+/, '$1');
  // "+00" / "+0530" → "+00:00" / "+05:30" for Date.parse.
  s = s.replace(/([+-]\d{2})(\d{2})?$/, (_m, h: string, mm?: string) => `${h}:${mm ?? '00'}`);
  return Date.parse(s);
}

/**
 * Refuse the edit (409 `edit_conflict`) when the row changed after the form
 * loaded it. No-op when the caller did not send `expectedUpdatedAt` (older
 * clients keep last-write-wins).
 *
 * ADR-225 — pass `changedByName` (and, if the caller has it, the row's current
 * `updated_at` is already `current`) so the 409 can say WHO and WHEN, which is
 * what §20.4 asks for: "changed by <name> at <time>". Omit it and the refusal
 * still works, it just cannot name anyone — the screen then says
 * "someone else". The name is a DISPLAY name resolved by the caller, never a
 * login id, and never an email.
 */
export function assertUnchangedSinceOpened(
  current: Date | string | null | undefined,
  expected: string | null | undefined,
  changedByName?: string | null,
): void {
  if (expected === undefined || expected === null || expected === '') return;
  const sentMs = timestampMs(expected);
  if (Number.isNaN(sentMs)) {
    throw new ValidationError('expectedUpdatedAt is not a valid timestamp');
  }
  if (current === null || current === undefined) return;
  if (timestampMs(current) !== sentMs) {
    const details: EditConflictDetails = {
      changedByName: changedByName ?? null,
      changedAt: current instanceof Date ? current.toISOString() : String(current),
    };
    throw new AppError(409, EDIT_CONFLICT_CODE, EDIT_CONFLICT_MESSAGE, details);
  }
}
