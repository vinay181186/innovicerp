// Partial Incoming QC on a Party GRN line (owner 2026-10-31, migration 0233) —
// the TWO line predicates, written once. A line received 60 may be inspected
// 6 now and 54 later; accepted_qty / rejected_qty are running totals.
//
//   QC UNTOUCHED — nothing inspected yet (qc_at NULL, 0 accepted, 0 rejected).
//     ONLY for "may this line still be edited / staged" (received qty and line
//     remarks freeze at the first inspection).
//   QC OPEN      — QC Pending Qty > 0, QC Pending Qty = received − accepted −
//     rejected. For every "waiting for Incoming QC" reader: the Party GRN list
//     and detail, the QC Call Register, the home QC row, the JWSO Customer RM.
//
// Lines booked before QC existed (migration 0173: accepted = received, qc_at
// NULL) are neither untouched nor open.
//
// Kept apart from ./service.ts so light readers — the
// register, the home rows, the JWSO Customer RM read — take only the SQL.
// Every SQL form uses the alias `pgl` for party_grn_lines; the untouched
// rule has no SQL form (no reader needs one), only qcUntouchedCond().

import { and, eq, isNull, sql } from 'drizzle-orm';
import { partyGrnLines } from '../../db/schema';

/** Nothing inspected yet, over the drizzle columns — for a conditional UPDATE
 *  of party_grn_lines (CLAUDE.md §20.2). */
export function qcUntouchedCond() {
  return and(
    isNull(partyGrnLines.qcAt),
    eq(partyGrnLines.acceptedQty, 0),
    eq(partyGrnLines.rejectedQty, 0),
  );
}

export function isQcUntouched(l: {
  qcAt: unknown;
  acceptedQty: number;
  rejectedQty: number;
}): boolean {
  return l.qcAt == null && l.acceptedQty === 0 && l.rejectedQty === 0;
}

/** QC Pending Qty of a line (alias pgl): received − accepted − rejected. */
export const QC_PENDING_QTY_SQL = sql.raw(
  '(pgl.received_qty - pgl.accepted_qty - pgl.rejected_qty)',
);

/** QC Pending Qty > 0 (alias pgl). */
export const QC_OPEN_SQL = sql`(${QC_PENDING_QTY_SQL} > 0)`;

export function qcPendingQtyOf(l: {
  receivedQty: number;
  acceptedQty: number;
  rejectedQty: number;
}): number {
  return Math.max(0, l.receivedQty - l.acceptedQty - l.rejectedQty);
}

export function isQcOpen(l: { receivedQty: number; acceptedQty: number; rejectedQty: number }) {
  return qcPendingQtyOf(l) > 0;
}
