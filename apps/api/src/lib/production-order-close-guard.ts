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
  /** Output of the JC's last live op — the qty Close would credit. */
  jcFinishedQty: number;
  /** True when the JC is settled with losses (see header). */
  jcSettledWithLosses: boolean;
}

/** Null when Close is allowed; otherwise the plain-English reason it is not. */
export function closeBlockedReason(item: CloseGuardInput): string | null {
  if (item.status !== 'open') return `Production Order is already closed`;
  const st = item.jcComputedStatus ?? 'no_ops';
  const jcDone = st === 'complete' || st === 'closed' || item.jcSettledWithLosses;
  if (!jcDone) {
    return `Job Card ${item.jcCodeText} is not complete yet (${st}) — finish all operations before closing`;
  }
  // "Nothing to credit" blocks only the ordinary path. A settled-with-losses
  // JC with 0 finished is a total loss and closes with nothing credited.
  if (item.jcFinishedQty <= 0 && !item.jcSettledWithLosses) {
    return `Job Card ${item.jcCodeText} reads ${st} but has no finished quantity to credit — nothing was accepted at its last operation; check its QC entries before closing`;
  }
  return null;
}
