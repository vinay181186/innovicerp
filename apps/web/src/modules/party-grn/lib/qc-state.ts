// Partial Incoming QC on a Party GRN (migration 0233, owner 2026-10-31) — the
// ONE web copy of the line / receipt QC rules. The QC popup, the list badge,
// the row expand, the edit modal and the print all read these, so a 60-received
// line with 6 inspected reads "Partial · 54 pending" everywhere.
//
//   QC Pending  = received − accepted − deviated (the server's qcPendingQty).
//   untouched   = nothing inspected yet: no QC stamp, accepted 0, deviated 0.
//                 Only an untouched line may still be edited (Received Qty).
//   state       = 'waiting' (untouched) · 'partial' (some inspected, some
//                 pending) · 'done' (nothing pending). Lines saved before
//                 migration 0193 carry their split with no QC stamp — 'done'.

import type { PartyGrnLine, PartyGrnListItem } from '@innovic/shared';

export type PgrnQcState = 'waiting' | 'partial' | 'done';

type LineQty = Pick<PartyGrnLine, 'receivedQty' | 'acceptedQty' | 'rejectedQty'>;

/** QC Pending of one line. Computed from the three quantities (the same sum
 *  the server stores in qcPendingQty), so it never reads a defaulted 0. */
export function qcPendingQtyOf(l: LineQty): number {
  return Math.max(0, l.receivedQty - l.acceptedQty - l.rejectedQty);
}

/** Nothing inspected on this line yet — the only state in which it is editable. */
export function isQcUntouched(
  l: Pick<PartyGrnLine, 'qcAt' | 'acceptedQty' | 'rejectedQty'>,
): boolean {
  return l.qcAt == null && l.acceptedQty === 0 && l.rejectedQty === 0;
}

/** QC state of one line. */
export function pgrnQcState(l: LineQty & Pick<PartyGrnLine, 'qcAt'>): PgrnQcState {
  if (isQcUntouched(l)) return 'waiting';
  return qcPendingQtyOf(l) > 0 ? 'partial' : 'done';
}

/** QC state of a whole receipt from its list-row totals. Nothing inspected =
 *  every received piece still pending. An older server that sends no
 *  totalQcPendingQty (defaulted 0) but pending lines reads 'waiting'. */
export function pgrnQcStateOfGrn(
  g: Pick<PartyGrnListItem, 'qcPendingLines' | 'totalQcPendingQty' | 'totalReceivedQty'>,
): PgrnQcState {
  if (g.qcPendingLines <= 0) return 'done';
  if (g.totalQcPendingQty <= 0 || g.totalQcPendingQty >= g.totalReceivedQty) return 'waiting';
  return 'partial';
}

/** Short label: "Waiting QC" · "Partial · n pending" · "QC done". */
export function pgrnQcLabel(state: PgrnQcState, pendingQty: number): string {
  if (state === 'waiting') return 'Waiting QC';
  if (state === 'partial') return `Partial · ${pendingQty} pending`;
  return 'QC done';
}

/** Badge class per state — the colours the list already used. */
export const PGRN_QC_BADGE: Record<PgrnQcState, string> = {
  waiting: 'b-amber',
  partial: 'b-blue',
  done: 'b-green',
};
