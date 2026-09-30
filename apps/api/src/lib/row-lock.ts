// Lock-then-check helpers for status moves (fix wave 1, area B2 — S3/S4/S5/S6/S12).
//
// The ERPNext rule: a document's status may only move FROM the status the user
// saw, and only once. Every service that changes a status therefore
//   1. reads the row `FOR UPDATE` inside its transaction (a second save on the
//      same row waits, then re-reads the committed row and is refused by the
//      ordinary status check), and
//   2. writes the new status with `WHERE status = <expected>` and treats
//      0 rows as "someone else got there first".
//
// Both halves end in the SAME plain 409, built here so the wording is one.
// The database backstops added by migration 0181 (a second active return-to-
// vendor DC per NC, OSP returned > sent, stock below zero) are mapped to plain
// 409 messages by `dbGuardConflictMessage`, used by the error handler.

import { ConflictError } from './errors';

/** The one message for a row that changed under the user's feet. */
export function changedByOtherError(ref: string): ConflictError {
  return new ConflictError(`${ref} was changed by someone else — reload the page and try again.`);
}

/** A guarded UPDATE … WHERE status = <expected> RETURNING that touched no row
 *  means another user moved the document first. */
export function assertRowUpdated(rows: readonly unknown[], ref: string): void {
  if (rows.length === 0) throw changedByOtherError(ref);
}

/** Plain messages for the 0181 database backstops. Keyed by constraint /
 *  index name, so an unrelated violation is never mislabelled. */
const DB_GUARD_MESSAGES: Record<string, string> = {
  delivery_challans_nc_active_uq:
    'This NC already has a return-to-vendor DC. Reload the page — someone else issued it just now.',
  jc_ops_osp_returned_le_sent:
    'Returned Qty cannot be more than the Qty sent to the vendor on this operation. Reload the page and try again.',
  item_stock_balances_on_hand_nonneg:
    'Stock cannot go below zero for this item. Someone else may have used the stock just now — reload and try again.',
};

/** SQLSTATE 23505 (unique) / 23514 (check) on one of the 0181 guards → its
 *  plain message; 40P01 (deadlock, two saves crossing) → the "changed by
 *  someone else" message. Anything else → null (not ours). */
export function dbGuardConflictMessage(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null;
  const outer = err as { code?: unknown; cause?: unknown };
  // A driver wrapper may carry the Postgres error as `cause`.
  const raw =
    outer.code === undefined && typeof outer.cause === 'object' && outer.cause !== null
      ? outer.cause
      : err;
  const e = raw as { code?: unknown; constraint_name?: unknown; constraint?: unknown };
  if (e.code === '40P01') {
    return 'Someone else saved the same document at the same moment — reload the page and try again.';
  }
  if (e.code !== '23505' && e.code !== '23514') return null;
  const name =
    typeof e.constraint_name === 'string'
      ? e.constraint_name
      : typeof e.constraint === 'string'
        ? e.constraint
        : null;
  return name ? (DB_GUARD_MESSAGES[name] ?? null) : null;
}
