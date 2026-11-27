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

import { ActivityAction } from '@innovic/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { jcOps, purchaseRequests } from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { assertRowUpdated } from '../../lib/row-lock';
import { emitActivityLog } from '../activity-log/service';

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
  await stepPlansBackFromPr(tx, pr, user);
  return releaseSourceJcOps(tx, pr.id, user);
}

// ADR-324 — a plan whose Direct Purchase / Full Outsource PR is cancelled goes
// back to 'planned' (the step before "PR Created") with the PR link cleared,
// so it can raise a new PR — no cascade, the plan is not cancelled. §20.2:
// conditional on the plan still being 'pr_created' on THIS PR; a plan that
// moved on (in production, cancelled) is left alone. The PR row is locked by
// the caller; the plan row is taken by the UPDATE itself.
export async function stepPlansBackFromPr(
  tx: DbTransaction,
  pr: { id: string; code: string },
  user: AuthContext,
): Promise<string[]> {
  const rows = (await tx.execute(sql`
    UPDATE public.plans
       SET plan_status = 'planned',
           dp_pr_id = CASE WHEN dp_pr_id = ${pr.id}::uuid THEN NULL ELSE dp_pr_id END,
           fo_pr_id = CASE WHEN fo_pr_id = ${pr.id}::uuid THEN NULL ELSE fo_pr_id END,
           updated_at = now(), updated_by = ${user.id}::uuid
     WHERE plan_status = 'pr_created' AND deleted_at IS NULL
       AND company_id = (SELECT company_id FROM public.purchase_requests WHERE id = ${pr.id}::uuid)
       AND (dp_pr_id = ${pr.id}::uuid OR fo_pr_id = ${pr.id}::uuid)
    RETURNING id, code, company_id AS "companyId"
  `)) as unknown as Array<{ id: string; code: string; companyId: string }>;
  for (const p of rows) {
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Edit,
        changes: [
          { field: 'planStatus', label: 'Plan Status', before: 'PR Created', after: 'Planned' },
        ],
        entity: 'Plan',
        entityId: p.id,
        refId: p.code,
        detail: `${p.code} back to Planned — ${pr.code} cancelled`,
      },
      p.companyId,
      user,
    );
  }
  return rows.map((p) => p.code);
}
