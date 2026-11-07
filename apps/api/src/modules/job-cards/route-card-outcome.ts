// ADR-282 — what a Job Card records about its Route Card: the card and Rev it is
// built on (route_card_id, route_card_revision) and whether a routing change is
// held back (route_card_not_sent). ONE writer. A leaf file (schema + drizzle only)
// so plans, production orders and the Route Card approval can reach it without
// an import cycle.

import { and, eq, isNull, or, sql } from 'drizzle-orm';
import type { JcRouteCardWriteBack } from '@innovic/shared';
import { jobCards, routeCards } from '../../db/schema';
import type { DbTransaction } from '../../db/with-user-context';

/** The Job Card's own Item + Drawing Rev: who it is, and which card it reads when
 *  the save returned no write-back. */
export interface JcCardContext {
  companyId: string;
  itemId: string;
  itemRevisionId: string | null;
  userId: string;
}

/**
 * Stamp the outcome of a routing save on the Job Card. Same transaction as the
 * save; 0 rows (a missing or deleted Job Card) is no error.
 *
 *   write-back written      → that card, its new Rev, nothing held back.
 *   sentForApproval         → nothing held back, Rev unchanged until approved.
 *   notSentReason           → held back, Rev unchanged.
 *   no write-back           → the routing reads the same as the card: its current
 *                             Rev, nothing held back. No card → no stamp.
 *
 * "Rev unchanged" keeps what the Job Card already holds for THAT card; a Job Card
 * being created, or one on another card, takes the Rev the write-back names.
 */
export async function recordRouteCardOutcome(
  tx: DbTransaction,
  jobCardId: string,
  writeBack: JcRouteCardWriteBack | null,
  ctx: JcCardContext,
  /** Approval of an earlier change: a change this Job Card held back after it
   *  stays held back, so Send to Route Card is still offered. */
  opts: { keepNotSent?: boolean } = {},
): Promise<void> {
  let cardId: string | null;
  let revision: number | null;
  if (writeBack) {
    cardId = writeBack.routeCardId;
    revision = writeBack.routeCardRevision;
  } else {
    // The same card saveRouteCardForItem resolves: one per Item + Rev; a no-Rev
    // Job Card reads the item's old no-Rev card.
    const card = (
      await tx
        .select({ id: routeCards.id, currentRevision: routeCards.currentRevision })
        .from(routeCards)
        .where(
          and(
            eq(routeCards.companyId, ctx.companyId),
            isNull(routeCards.deletedAt),
            ctx.itemRevisionId
              ? eq(routeCards.itemRevisionId, ctx.itemRevisionId)
              : and(eq(routeCards.itemId, ctx.itemId), isNull(routeCards.itemRevisionId)),
          ),
        )
        .limit(1)
    )[0];
    cardId = card?.id ?? null;
    revision = card?.currentRevision ?? null;
  }
  const heldBack = Boolean(writeBack?.notSentReason);
  const keepRevision = heldBack || writeBack?.sentForApproval === true;
  await tx
    .update(jobCards)
    .set({
      routeCardId: cardId,
      routeCardRevision: keepRevision
        ? sql`CASE WHEN ${jobCards.routeCardId} = ${cardId}::uuid
                    AND ${jobCards.routeCardRevision} IS NOT NULL
                   THEN ${jobCards.routeCardRevision} ELSE ${revision}::int END`
        : revision,
      ...(opts.keepNotSent ? {} : { routeCardNotSent: heldBack }),
      updatedBy: ctx.userId,
    })
    .where(
      and(
        eq(jobCards.id, jobCardId),
        eq(jobCards.companyId, ctx.companyId),
        isNull(jobCards.deletedAt),
      ),
    );
}

/**
 * A routing change this Job Card proposed was approved: the Job Card is now on
 * the Rev the approval made. A later change it held back stays held back. Never
 * fails the approval.
 *
 * SKIP LOCKED, because this runs holding route_cards and a Job Card save goes
 * job_cards → route_cards; waiting here could deadlock the approver against that
 * save (40P01). A locked row is left unstamped (it stays on its older Rev, shown
 * as such, never as different) and the save holding it records its own outcome.
 *
 * A Job Card since moved to another card (Drawing Rev change) keeps that card.
 */
export async function stampApprovedRouteCard(
  tx: DbTransaction,
  companyId: string,
  jobCardId: string,
  written: JcRouteCardWriteBack,
  userId: string,
): Promise<void> {
  const rows = await tx
    .select({ itemId: jobCards.itemId, itemRevisionId: jobCards.itemRevisionId })
    .from(jobCards)
    .where(
      and(
        eq(jobCards.id, jobCardId),
        eq(jobCards.companyId, companyId),
        isNull(jobCards.deletedAt),
        or(isNull(jobCards.routeCardId), eq(jobCards.routeCardId, written.routeCardId)),
      ),
    )
    .limit(1)
    .for('update', { skipLocked: true });
  const jc = rows[0];
  if (!jc) return;
  await recordRouteCardOutcome(
    tx,
    jobCardId,
    written,
    {
      companyId,
      itemId: jc.itemId,
      itemRevisionId: jc.itemRevisionId,
      userId,
    },
    { keepNotSent: true },
  );
}
