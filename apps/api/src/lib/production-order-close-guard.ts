// Production Order close guard — the ONE place the "may this be closed?"
// sentence is written (ADR-170).
//
// The detail view shows it as `closeBlockedReason`; Close throws exactly the
// same words, so what the screen says and what the server refuses can never
// differ. Pure: no database, so production-orders/service.ts computes the
// inputs (live, off the views) and this decides.
//
// Two ways a Job Card is "done enough" to close its Production Order:
//
//   1. v_jc_status.computed_status is 'complete' or 'closed' — every op
//      reached the full order qty. The normal path; unchanged. It must still
//      have a finished qty to credit: a 'complete' JC whose last op accepted
//      nothing is a data inconsistency, not a closable order.
//
//   2. "settled with losses" (`jcSettledWithLosses`, TEST run 2026-09-17,
//      flow-po.spec.ts S1-d, IN-PRO-00001 / IN-JC-26-00055): 50 ordered,
//      Turning 50 → DIR accept 48 / reject 2 → NC scrapped 2 → Milling 48 →
//      Final Inspection accept 48. v_jc_op_status never subtracts lost
//      pieces from the `complete` bar (output >= order qty on every op), so
//      that JC reads 'open' forever and the 48 good pieces could never be
//      credited. The service's jcSettledWithLossesSql says true only when
//      every op has nothing left to do, no NC / rework / repair child is
//      open, and finished + loss >= order qty with at least one piece lost
//      (scrapped, failed in a rework / repair child, or made fresh — code
//      review of e69d15e8 generalised it from "scrapped at a QC op").
//      Credited qty is still the last op's finished qty (48), never the plan.
//      A settled JC that lost EVERY piece (finished 0) is allowed through: the
//      service closes it with credited_qty 0 and writes no stock row.

export interface CloseGuardInput {
  /** production_orders.status */
  status: string;
  jcCodeText: string;
  /** v_jc_status.computed_status of the linked JC; null when the JC row is gone. */
  jcComputedStatus: string | null;
  /** Output of the JC's last live op — the TOTAL finished so far. */
  jcFinishedQty: number;
  /** True when the JC is settled with losses (see header). */
  jcSettledWithLosses: boolean;
  /** Running total already credited by earlier partial closes (ADR-179). */
  creditedQty: number;
  /** ADR-182 — when the order was short closed (ISO or YYYY-MM-DD), null
   *  unless `status === 'short_closed'`. Only used for the wording. */
  shortClosedAt?: string | null;
}

/** YYYY-MM-DD out of whatever the row carried, so the sentence never shows a
 *  timestamp or the word "null". */
function shortCloseDate(v: string | null | undefined): string {
  return v ? v.slice(0, 10) : 'an earlier date';
}

/** Null when SOME close action is possible right now; otherwise the plain-English
 *  reason none is. Partial close (ADR-179): a close is possible when the order is
 *  not already fully closed AND either
 *   - there are new finished pieces to credit now (availableToClose > 0), OR
 *   - the JC is done (complete / closed / settled-with-losses) so it can be
 *     finished / closed short.
 *  The service then enforces the action-specific rules (a "close short" still
 *  requires the JC to be done; a plain partial close does not). */
export function closeBlockedReason(item: CloseGuardInput): string | null {
  // ADR-182 — a short-closed order is dead. Pieces already credited stay
  // credited, but nothing more may be closed (or reversed) on it.
  if (item.status === 'short_closed') {
    return `No further close — this order was short closed on ${shortCloseDate(item.shortClosedAt)}`;
  }
  if (item.status === 'closed') return `Production Order is already fully closed`;
  const st = item.jcComputedStatus ?? 'no_ops';
  const jcDone = st === 'complete' || st === 'closed' || item.jcSettledWithLosses;
  const available = Math.max(0, item.jcFinishedQty - item.creditedQty);
  if (available <= 0 && !jcDone) {
    return `No Completed pieces to close yet on JC No. ${item.jcCodeText}. Try again once its last operation completes pieces.`;
  }
  return null;
}
