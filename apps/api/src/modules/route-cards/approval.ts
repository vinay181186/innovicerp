// ADR-253 — approve / reject a NEW Route Card (POST /route-cards/:id/approve,
// /route-cards/:id/reject). Same shape as approvePurchaseRequest /
// rejectPurchaseRequest: the Approve tick on Route Card Master decides (the
// creator may approve their own card, like PR / PO), the row is locked, the
// status moves with a conditional UPDATE … WHERE approval_status = 'pending'
// (CLAUDE.md §20.2), and a loser is told who decided first.
//
// Approval is also where the card's raw material first reaches the waiting
// plans (T2 plan-rm-backfill): a pending card is not usable, so createRouteCard
// no longer runs the backfill — it runs here, inside the approval transaction.
//
// LOCK ORDER (§20.3) — plans BEFORE route_cards, as createRouteCard /
// updateRouteCardTx / executePlan take them: lockBackfillCandidates first,
// then the card row FOR UPDATE.

import {
  ActivityAction,
  type ApproveRouteCardInput,
  type RejectRouteCardInput,
} from '@innovic/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { routeCards } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { AuthorizationError, ConflictError, NotFoundError } from '../../lib/errors';
import { fmtDateTime } from '../../lib/format-date';
import { assertRowUpdated } from '../../lib/row-lock';
import { emitActivityLog } from '../activity-log/service';
import {
  backfillPlansFromRouteCard,
  lockBackfillCandidates,
  readRouteCardRawMaterial,
} from '../plans/rm-backfill';
import type { RouteCardDetail } from './schema';
import { loadRouteCardDetail, loadUserNames, rcStatusChange } from './service';

type RcRow = typeof routeCards.$inferSelect;

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

/** Lock the item's backfill-candidate plans, then the card row (§20.3), and
 *  refuse unless the card is still Pending Approval — naming who decided it. */
async function lockPendingCard(
  tx: DbTransaction,
  companyId: string,
  id: string,
  verb: 'approve' | 'reject',
): Promise<RcRow> {
  const live = and(
    eq(routeCards.id, id),
    eq(routeCards.companyId, companyId),
    isNull(routeCards.deletedAt),
  );
  // The item is read unlocked only to name the plans to lock; the candidate
  // set keys on the PLANS' own columns (see lockBackfillCandidates).
  const pre = await tx.select({ itemId: routeCards.itemId }).from(routeCards).where(live).limit(1);
  if (!pre[0]) throw new NotFoundError('Route Card not found. It may have been moved to Trash.');
  await lockBackfillCandidates(tx, companyId, pre[0].itemId);

  const rows = await tx.select().from(routeCards).where(live).limit(1).for('update');
  const card = rows[0];
  if (!card) throw new NotFoundError('Route Card not found. It may have been moved to Trash.');
  if (card.approvalStatus !== 'pending') {
    const names = await loadUserNames(tx, [card.approvedBy, card.rejectedBy]);
    const decided =
      card.approvalStatus === 'approved'
        ? `was already approved${card.approvedBy && names.get(card.approvedBy) ? ` by ${names.get(card.approvedBy)}` : ''}${card.approvedAt ? ` at ${fmtDateTime(card.approvedAt)}` : ''}`
        : `was rejected${card.rejectedBy && names.get(card.rejectedBy) ? ` by ${names.get(card.rejectedBy)}` : ''}${card.rejectedAt ? ` at ${fmtDateTime(card.rejectedAt)}` : ''}`;
    throw new ConflictError(
      `Cannot ${verb} Route Card ${card.code}: it ${decided}. Reload the page.`,
    );
  }
  return card;
}

export async function approveRouteCard(
  id: string,
  input: ApproveRouteCardInput,
  user: AuthContext,
): Promise<RouteCardDetail> {
  // Self-approval allowed (owner, 2026-10-24) — the tick alone decides.
  await requireFormAccess(user, 'routecard_create', 'approve');
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const card = await lockPendingCard(tx, companyId, id, 'approve');
    const now = new Date();
    const updated = await tx
      .update(routeCards)
      .set({
        approvalStatus: 'approved',
        approvedBy: user.id,
        approvedAt: now,
        // §20.4 — a form opened on the pending card must reload before it saves.
        updatedBy: user.id,
        updatedAt: now,
      })
      .where(and(eq(routeCards.id, id), eq(routeCards.approvalStatus, 'pending')))
      .returning({ id: routeCards.id });
    assertRowUpdated(updated, `Route Card ${card.code}`);

    // T2 (plan-rm-backfill) — the card is usable from this moment, so its raw
    // material now goes to the item's blank, waiting plans (fill-blanks-only,
    // never a plan whose Job Card exists — the guards live in
    // backfillPlansFromRouteCard). Same calls createRouteCard used to make,
    // inside THIS transaction: a failed backfill rolls the approval back.
    const rcRm = await readRouteCardRawMaterial(tx, companyId, card.itemId);
    if (rcRm) await backfillPlansFromRouteCard(tx, companyId, card.itemId, rcRm, user);

    const remarks = input.remarks?.trim() || null;
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Approve,
        entity: 'RouteCard',
        entityId: card.id,
        refId: card.code,
        changes: [rcStatusChange('pending', 'approved')],
        reason: remarks,
        detail: `${card.code} approved by ${user.fullName || user.email}${remarks ? ` — ${remarks}` : ''}`,
      },
      companyId,
      user,
    );
    return loadRouteCardDetail(tx, id, companyId);
  });
}

export async function rejectRouteCard(
  id: string,
  input: RejectRouteCardInput,
  user: AuthContext,
): Promise<RouteCardDetail> {
  // Rejecting is the other half of approving — same right.
  await requireFormAccess(user, 'routecard_create', 'approve');
  const companyId = requireCompany(user);
  // The route schema already refuses a blank reason (activityReasonSchema);
  // trimmed again here for a direct service caller.
  const reason = input.reason.trim();

  return withUserContext(user, async (tx) => {
    const card = await lockPendingCard(tx, companyId, id, 'reject');
    const now = new Date();
    const updated = await tx
      .update(routeCards)
      .set({
        approvalStatus: 'rejected',
        rejectedBy: user.id,
        rejectedAt: now,
        rejectionReason: reason,
        updatedBy: user.id,
        updatedAt: now,
      })
      .where(and(eq(routeCards.id, id), eq(routeCards.approvalStatus, 'pending')))
      .returning({ id: routeCards.id });
    assertRowUpdated(updated, `Route Card ${card.code}`);

    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Reject,
        entity: 'RouteCard',
        entityId: card.id,
        refId: card.code,
        changes: [rcStatusChange('pending', 'rejected')],
        reason,
        detail: `${card.code} rejected by ${user.fullName || user.email} — ${reason}`,
      },
      companyId,
      user,
    );
    return loadRouteCardDetail(tx, id, companyId);
  });
}
