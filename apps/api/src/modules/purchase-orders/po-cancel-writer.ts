// The ONE writer that turns a Purchase Order into 'cancelled' (§20.1), and
// the hand-back of what it was holding (G9a).
//
// Three callers, one set of writes:
//   - rejectPurchaseOrder        — the approver turns a Draft down (rejected_* stamp);
//   - shortClosePurchaseOrder    — its stop-wholly branch: nothing received and
//                                  nothing sent, so the PO is cancelled outright
//                                  (short_closed_* stamp, ADR-189);
//   - cancelPurchaseOrderTx      — an approved Cancel Request (ADR-235; cancel.ts),
//                                  stamped like the stop-wholly branch.
// Each flips the status conditionally on the status read under the caller's
// lock (§20.2), then releaseJcOpsForCancelledPo hands the PRs and the
// outsourced JC ops back. Each caller writes its own activity row.
//
// Kept apart from service.ts (4,500+ lines) on purpose; service.ts and
// cancel.ts both import this file, and it imports neither.

import { ActivityAction, opSrNo } from '@innovic/shared';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  jcOpPoLines,
  jcOps,
  jobCards,
  purchaseOrderLines,
  purchaseOrders,
  purchaseRequests,
} from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { assertRowUpdated } from '../../lib/row-lock';
import { emitActivityLog } from '../activity-log/service';

/** Which who / when / why columns the cancel stamps. */
export type PoCancelStamp = 'rejected' | 'stopped';

/**
 * Mark a locked PO 'cancelled' and release what it held. `po.status` is the
 * status read under the caller's FOR UPDATE lock; the UPDATE only moves a row
 * still in it (0 rows → 409 "changed by someone else").
 *
 *  - 'rejected' → rejected_by / rejected_at / rejection_reason (Reject).
 *  - 'stopped'  → short_closed_by / short_closed_at / short_close_reason —
 *                 who stopped an ISSUED PO, when and why (ADR-189, 0151). The
 *                 PO has no cancel_* columns; these are the ones today's
 *                 "cancel an issued PO" (Short Close, nothing received) writes.
 */
export async function markPoCancelledTx(
  tx: DbTransaction,
  companyId: string,
  po: { id: string; code: string; status: string },
  stamp: PoCancelStamp,
  reason: string,
  user: AuthContext,
): Promise<void> {
  const now = new Date();
  const who =
    stamp === 'rejected'
      ? { rejectedBy: user.id, rejectedAt: now, rejectionReason: reason }
      : { shortClosedBy: user.id, shortClosedAt: now, shortCloseReason: reason };
  const moved = await tx
    .update(purchaseOrders)
    .set({ status: 'cancelled', ...who, updatedBy: user.id, updatedAt: now })
    .where(
      and(
        eq(purchaseOrders.id, po.id),
        eq(purchaseOrders.companyId, companyId),
        eq(purchaseOrders.status, po.status as typeof purchaseOrders.$inferSelect.status),
      ),
    )
    .returning({ id: purchaseOrders.id });
  assertRowUpdated(moved, `PO ${po.code}`);
  // G9a: a cancelled PO holds nothing — hand its outsourced ops and PRs back.
  await releaseJcOpsForCancelledPo(tx, companyId, { id: po.id, code: po.code }, user);
}

/** Free every outsourced op and PR this PO was holding. Runs inside the
 *  caller's tx, AFTER the PO row has been marked cancelled / deleted.
 *
 *  Per jc_ops row whose `outsource_po_line_id` is one of this PO's lines:
 *   - its jc_op_po_lines rows on this PO are soft-deleted;
 *   - if another live link (a second PO) still covers the op, the legacy
 *     column is re-pointed at that line and the op keeps its status;
 *   - otherwise `outsource_po_line_id` is cleared and the op goes back to
 *     `pr_raised` when its PR is still alive, or all the way to NULL (no PR)
 *     when the PR is cancelled / gone — the same resting state
 *     releaseSourceJcOps leaves, so the JC edit auto-PR can raise a fresh one.
 *  Per PR this PO drew on (line source_pr_id or the op's outsource_pr_id):
 *   - when no OTHER live PO line remains, status goes back from `po_created`
 *     to `approved` (if it had been approved) or `open`, and the first-PO
 *     stamp (po_id / po_created_at) is cleared if it named this PO — with the
 *     lines soft-deleted, a stale po_id would make deriveOrderedQty read the
 *     PR as fully bought forever (the legacy rule there). */
export async function releaseJcOpsForCancelledPo(
  tx: DbTransaction,
  companyId: string,
  po: { id: string; code: string },
  user: AuthContext,
): Promise<void> {
  const now = new Date();
  // Every line of this PO, soft-deleted or not: an op may still point at one.
  const lineRows = await tx
    .select({ id: purchaseOrderLines.id, sourcePrId: purchaseOrderLines.sourcePrId })
    .from(purchaseOrderLines)
    .where(
      and(
        eq(purchaseOrderLines.purchaseOrderId, po.id),
        eq(purchaseOrderLines.companyId, companyId),
      ),
    );
  const lineIds = lineRows.map((l) => l.id);
  if (lineIds.length === 0) return;

  const ops = await tx
    .select({
      id: jcOps.id,
      jobCardId: jcOps.jobCardId,
      opSeq: jcOps.opSeq,
      operation: jcOps.operation,
      outsourcePrId: jcOps.outsourcePrId,
      outsourceStatus: jcOps.outsourceStatus,
    })
    .from(jcOps)
    .where(
      and(
        eq(jcOps.companyId, companyId),
        inArray(jcOps.outsourcePoLineId, lineIds),
        isNull(jcOps.deletedAt),
      ),
    );

  // The multi-PO links on this PO's lines are dead with it.
  await tx
    .update(jcOpPoLines)
    .set({ deletedAt: now, updatedAt: now, updatedBy: user.id })
    .where(
      and(
        eq(jcOpPoLines.companyId, companyId),
        inArray(jcOpPoLines.purchaseOrderLineId, lineIds),
        isNull(jcOpPoLines.deletedAt),
      ),
    );

  // PRs in play: the lines' source PRs plus the ops' own PR links.
  const prIds = Array.from(
    new Set(
      [...lineRows.map((l) => l.sourcePrId), ...ops.map((o) => o.outsourcePrId)].filter(
        (v): v is string => Boolean(v),
      ),
    ),
  );
  const prRows =
    prIds.length === 0
      ? []
      : await tx
          .select({
            id: purchaseRequests.id,
            code: purchaseRequests.code,
            status: purchaseRequests.status,
            poId: purchaseRequests.poId,
            approvedAt: purchaseRequests.approvedAt,
          })
          .from(purchaseRequests)
          .where(
            and(
              eq(purchaseRequests.companyId, companyId),
              inArray(purchaseRequests.id, prIds),
              isNull(purchaseRequests.deletedAt),
            ),
          );
  const prById = new Map(prRows.map((p) => [p.id, p]));

  const jcCodeById = new Map<string, string>();
  if (ops.length > 0) {
    const jcRows = await tx
      .select({ id: jobCards.id, code: jobCards.code })
      .from(jobCards)
      .where(inArray(jobCards.id, Array.from(new Set(ops.map((o) => o.jobCardId)))));
    for (const r of jcRows) jcCodeById.set(r.id, r.code);
  }

  for (const op of ops) {
    // A second, still-live PO on this op? Keep the op committed to it.
    const other = await tx
      .select({ purchaseOrderLineId: jcOpPoLines.purchaseOrderLineId })
      .from(jcOpPoLines)
      .innerJoin(purchaseOrderLines, eq(purchaseOrderLines.id, jcOpPoLines.purchaseOrderLineId))
      .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderLines.purchaseOrderId))
      .where(
        and(
          eq(jcOpPoLines.jcOpId, op.id),
          isNull(jcOpPoLines.deletedAt),
          isNull(purchaseOrderLines.deletedAt),
          isNull(purchaseOrders.deletedAt),
          sql`${purchaseOrders.status} <> 'cancelled'`,
        ),
      )
      .orderBy(asc(jcOpPoLines.createdAt))
      .limit(1);
    const jcCode = jcCodeById.get(op.jobCardId) ?? op.jobCardId;
    if (other[0]) {
      await tx
        .update(jcOps)
        .set({
          outsourcePoLineId: other[0].purchaseOrderLineId,
          updatedAt: now,
          updatedBy: user.id,
        })
        .where(eq(jcOps.id, op.id));
      await emitActivityLog(
        tx,
        {
          action: ActivityAction.Edit,
          entity: 'JobCard',
          entityId: op.jobCardId,
          opRef: `Op ${opSrNo(op.opSeq)} · ${op.operation}`,
          // display rule — see opSrNo in @innovic/shared
          detail: `${jcCode} Op${opSrNo(op.opSeq)} "${op.operation}" — PO ${po.code} cancelled; op stays on its other purchase order`,
          refId: jcCode,
        },
        companyId,
        user,
      );
      continue;
    }
    const pr = op.outsourcePrId ? prById.get(op.outsourcePrId) : undefined;
    const prAlive = pr !== undefined && pr.status !== 'cancelled';
    await tx
      .update(jcOps)
      .set({
        outsourcePoLineId: null,
        outsourcePrId: prAlive ? op.outsourcePrId : null,
        outsourceStatus: prAlive ? 'pr_raised' : null,
        updatedAt: now,
        updatedBy: user.id,
      })
      .where(eq(jcOps.id, op.id));
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Edit,
        entity: 'JobCard',
        entityId: op.jobCardId,
        opRef: `Op ${opSrNo(op.opSeq)} · ${op.operation}`,
        detail:
          `${jcCode} Op${opSrNo(op.opSeq)} "${op.operation}" — released from PO ${po.code} (cancelled): ` +
          (prAlive && pr ? `back to PR raised (${pr.code})` : 'no PR — awaiting a fresh PR'),
        refId: jcCode,
      },
      companyId,
      user,
    );
  }

  // PRs: reopen the ones this was the only purchase order for.
  for (const pr of prRows) {
    if (pr.status !== 'po_created') continue;
    const remaining = await tx
      .select({ id: purchaseOrderLines.id })
      .from(purchaseOrderLines)
      .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderLines.purchaseOrderId))
      .where(
        and(
          eq(purchaseOrderLines.sourcePrId, pr.id),
          sql`${purchaseOrderLines.purchaseOrderId} <> ${po.id}::uuid`,
          isNull(purchaseOrderLines.deletedAt),
          isNull(purchaseOrders.deletedAt),
          sql`${purchaseOrders.status} <> 'cancelled'`,
        ),
      )
      .limit(1);
    if (remaining[0]) continue;
    const backTo = pr.approvedAt ? 'approved' : 'open';
    await tx
      .update(purchaseRequests)
      .set({
        status: backTo,
        ...(pr.poId === po.id ? { poId: null, poCreatedAt: null } : {}),
        updatedBy: user.id,
        updatedAt: now,
      })
      .where(eq(purchaseRequests.id, pr.id));
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Edit,
        entity: 'PurchaseRequest',
        entityId: pr.id,
        changes: [
          {
            field: 'status',
            label: 'PR Status',
            before: 'PO Created',
            after: backTo === 'approved' ? 'Approved' : 'Open',
          },
        ],
        detail: `${pr.code} back to ${backTo === 'approved' ? 'Approved' : 'Open'} — PO ${po.code} was cancelled`,
        refId: pr.code,
      },
      companyId,
      user,
    );
  }
}
