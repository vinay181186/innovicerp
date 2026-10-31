// Part QC on a Party GRN (migration 0233, owner 2026-10-31) — the ONE web copy
// of the line / receipt QC rules. The QC popup, the list badge, the row expand,
// the edit modal and the print all read these, so a 60-received line with 6
// inspected reads "Part QC · 54 pending" everywhere.
//
//   QC Pending  = the SERVER's figure (line.qcPendingQty; receipt
//                 qcPendingLines / totalQcPendingQty). Never re-derived here
//                 (CLAUDE.md §6.1) — the server zeroes it on a cancelled GRN.
//   untouched   = nothing inspected yet: no QC stamp, accepted 0, deviated 0.
//                 Only an untouched line may still be edited (Received Qty).
//   state       = 'waiting' (untouched) · 'partial' (some inspected, some
//                 pending) · 'done' (nothing pending).

import type { PartyGrnLine, PartyGrnListItem } from '@innovic/shared';

export type PgrnQcState = 'waiting' | 'partial' | 'done';

/** QC Pending of one line — the server's qcPendingQty. */
export function qcPendingQtyOf(l: Pick<PartyGrnLine, 'qcPendingQty'>): number {
  return l.qcPendingQty;
}

/** Nothing inspected on this line yet — the only state in which it is editable. */
export function isQcUntouched(
  l: Pick<PartyGrnLine, 'qcAt' | 'acceptedQty' | 'rejectedQty'>,
): boolean {
  return l.qcAt == null && l.acceptedQty === 0 && l.rejectedQty === 0;
}

/** QC state of one line. */
export function pgrnQcState(
  l: Pick<PartyGrnLine, 'qcAt' | 'acceptedQty' | 'rejectedQty' | 'qcPendingQty'>,
): PgrnQcState {
  if (isQcUntouched(l)) return 'waiting';
  return qcPendingQtyOf(l) > 0 ? 'partial' : 'done';
}

/** QC state of a whole receipt from the server's totals. Nothing inspected =
 *  every received piece still pending. */
export function pgrnQcStateOfGrn(
  g: Pick<PartyGrnListItem, 'qcPendingLines' | 'totalQcPendingQty' | 'totalReceivedQty'>,
): PgrnQcState {
  if (g.qcPendingLines <= 0 || g.totalQcPendingQty <= 0) return 'done';
  return g.totalQcPendingQty >= g.totalReceivedQty ? 'waiting' : 'partial';
}

/** Short label: "Waiting QC" · "Part QC · n pending" · "QC done". */
export function pgrnQcLabel(state: PgrnQcState, pendingQty: number): string {
  if (state === 'waiting') return 'Waiting QC';
  if (state === 'partial') return `Part QC · ${pendingQty} pending`;
  return 'QC done';
}

/** Badge class per state — the colours the list already used. */
export const PGRN_QC_BADGE: Record<PgrnQcState, string> = {
  waiting: 'b-amber',
  partial: 'b-blue',
  done: 'b-green',
};
