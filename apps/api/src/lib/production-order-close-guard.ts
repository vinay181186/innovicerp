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
//      reached the full order qty. The normal path; unchanged.
//
//   2. "settled with losses" (`jcSettledWithScrap`, TEST run 2026-09-17,
//      flow-po.spec.ts S1-d, IN-PRO-00001 / IN-JC-26-00055): 50 ordered,
//      Turning 50 → DIR accept 48 / reject 2 → NC scrapped 2 → Milling 48 →
//      Final Inspection accept 48. v_jc_op_status never subtracts scrapped
//      pieces from the `complete` bar (output >= order qty on every op), so
//      that JC reads 'open' forever and the 48 good pieces could never be
//      credited. The service's JC_SETTLED_WITH_SCRAP_SQL says true only when
//      every op has nothing left to do, no NC / rework child is open, and
//      finished + scrapped >= order qty with at least one piece scrapped.
//      Credited qty is still the last op's finished qty (48), never the plan.

export interface CloseGuardInput {
  /** production_orders.status */
  status: string;
  jcCodeText: string;
  /** v_jc_status.computed_status of the linked JC; null when the JC row is gone. */
  jcComputedStatus: string | null;
  /** Output of the JC's last live op — the qty Close would credit. */
  jcFinishedQty: number;
  /** True when the JC is settled with scrap losses (see header). */
  jcSettledWithScrap: boolean;
}

/** Null when Close is allowed; otherwise the plain-English reason it is not. */
export function closeBlockedReason(item: CloseGuardInput): string | null {
  if (item.status !== 'open') return `Production Order is already closed`;
  const st = item.jcComputedStatus ?? 'no_ops';
  const jcDone = st === 'complete' || st === 'closed' || item.jcSettledWithScrap;
  if (!jcDone) {
    return `Job Card ${item.jcCodeText} is not complete yet (${st}) — finish all operations before closing`;
  }
  if (item.jcFinishedQty <= 0) {
    return `Job Card ${item.jcCodeText} has no finished quantity to credit — nothing was accepted at its last operation`;
  }
  return null;
}
