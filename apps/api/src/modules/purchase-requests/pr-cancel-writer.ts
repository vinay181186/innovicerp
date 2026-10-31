// The ONE writer that turns a live Purchase Request into 'cancelled' (§20.1).
//
// One caller today: cancelPurchaseRequestTx (cancel.ts) — the one-step Cancel
// (ADR-235; owner rule 2026-10-31). The old Reject caller is retired (PRs have
// no approval); the 'rejected' kind stays only so the type reads as before.
// It flips the status conditionally on the status read under the caller's
// lock (§20.2), stamp who / when / why, append the reason to remarks (the PR
// screens still read it from there), and hand the JC op(s) the PR was raised
// against back (ADR-101). Each caller writes its own activity row (REJECT vs
// CANCEL).
//
// Kept apart from service.ts on purpose: cancel.ts imports service.ts, and
// service.ts imports this file — neither imports the other back.

import { and, eq, inArray, isNull } from 'drizzle-orm';
import { jcOps, purchaseRequests } from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { assertRowUpdated } from '../../lib/row-lock';

// ADR-101 — un-stamp the JC op(s) a dead PR was raised against.
//
// `jc_ops.outsource_pr_id` + `outsource_status` are what the JC-edit lock guard
// (job-cards/service.ts) reads to decide "this op is committed to procurement".
// Cancelling or deleting the PR used to leave that stamp behind, so the op was
// frozen forever — no retype to in-house, no removal — even though the user had
// done exactly what the error message told them to do. Clearing it here also
// makes the op eligible for a fresh PR again, which is the correct next state
// for an outsource op with no live paperwork.
//
// Ops that carry a PO line, or whose status is past PO issue, are left alone:
// those are real commitments and are not reachable from a pre-PO PR anyway.
export async function releaseSourceJcOps(
  tx: DbTransaction,
  prId: string,
  user: AuthContext,
): Promise<number> {
  const rows = await tx
    .update(jcOps)
    .set({ outsourcePrId: null, outsourceStatus: null, updatedBy: user.id, updatedAt: new Date() })
    .where(
      and(
        eq(jcOps.outsourcePrId, prId),
        isNull(jcOps.outsourcePoLineId),
        isNull(jcOps.deletedAt),
        inArray(jcOps.outsourceStatus, ['pending', 'pr_raised']),
      ),
    )
    .returning({ id: jcOps.id });
  return rows.length;
}

/** Which caller is ending the PR — decides only the remarks tag. */
export type PrEndKind = 'rejected' | 'cancelled';

const REMARKS_TAG: Record<PrEndKind, string> = {
  rejected: '[Rejected]',
  cancelled: '[Cancelled]',
};

/**
 * Mark a locked, live PR 'cancelled'. The caller has already locked the row
 * FOR UPDATE and proved nothing of it is on a live PO. `pr.status` is the
 * status read under that lock — the UPDATE only moves a row still in it.
 *
 * Stamps rejected_by / rejected_at / rejection_reason (ADR-197, 0178): the PR
 * has no cancel_* columns, and these are the PR's only who / when / why stamp
 * for "this request is dead". The remarks tag tells a Reject from a Cancel.
 *
 * Returns how many JC ops were handed back.
 */
export async function markPrCancelledTx(
  tx: DbTransaction,
  pr: { id: string; code: string; status: string; remarks: string | null },
  kind: PrEndKind,
  reason: string,
  user: AuthContext,
): Promise<number> {
  const tagged = `${REMARKS_TAG[kind]} ${reason}`;
  const stampedRemarks = pr.remarks ? `${pr.remarks}\n${tagged}` : tagged;
  const now = new Date();
  const moved = await tx
    .update(purchaseRequests)
    .set({
      status: 'cancelled',
      remarks: stampedRemarks,
      rejectedBy: user.id,
      rejectedAt: now,
      rejectionReason: reason,
      updatedBy: user.id,
      updatedAt: now,
    })
    // Expected status: the one read under the lock (never 'cancelled').
    .where(
      and(
        eq(purchaseRequests.id, pr.id),
        eq(purchaseRequests.status, pr.status as typeof purchaseRequests.$inferSelect.status),
      ),
    )
    .returning({ id: purchaseRequests.id });
  assertRowUpdated(moved, `PR ${pr.code}`);
  return releaseSourceJcOps(tx, pr.id, user);
}
