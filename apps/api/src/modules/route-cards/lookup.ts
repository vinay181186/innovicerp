// The ONE Route Card for an Item + Drawing Rev (0232: one card per Item + Rev;
// old cards with no Rev keep one per item). Shared by the Route Card writers
// and the plan / PRO lookups.

import { and, eq, isNull } from 'drizzle-orm';
import { itemRevisions, routeCards } from '../../db/schema';
import type { DbTransaction } from '../../db/with-user-context';

export interface RouteCardForItemRevision {
  id: string;
  code: string;
  approvalStatus: string;
}

/** Rev given → the card holding that item_revision_id; null → the card of
 *  that item with NO Rev (an old card). Live cards only. */
export async function findRouteCardForItemRevision(
  tx: DbTransaction,
  companyId: string,
  itemId: string,
  itemRevisionId: string | null,
): Promise<RouteCardForItemRevision | null> {
  const [row] = await tx
    .select({ id: routeCards.id, code: routeCards.code, approvalStatus: routeCards.approvalStatus })
    .from(routeCards)
    .where(
      and(
        eq(routeCards.companyId, companyId),
        isNull(routeCards.deletedAt),
        itemRevisionId
          ? eq(routeCards.itemRevisionId, itemRevisionId)
          : and(eq(routeCards.itemId, itemId), isNull(routeCards.itemRevisionId)),
      ),
    )
    .limit(1);
  return row ?? null;
}

export interface CardDrawing {
  itemRevisionId: string | null;
  drawingRev: string | null;
  drawingFilePath: string | null;
  drawingNo: string | null;
}

/** The card's Item + Drawing Rev and the register's drawing (0232). */
export async function readCardDrawing(
  tx: DbTransaction,
  itemRevisionId: string | null,
): Promise<CardDrawing> {
  if (!itemRevisionId) {
    return { itemRevisionId: null, drawingRev: null, drawingFilePath: null, drawingNo: null };
  }
  const [r] = await tx
    .select({
      rev: itemRevisions.rev,
      drawingFilePath: itemRevisions.drawingFilePath,
      drawingNo: itemRevisions.drawingNo,
    })
    .from(itemRevisions)
    .where(eq(itemRevisions.id, itemRevisionId))
    .limit(1);
  return {
    itemRevisionId,
    drawingRev: r?.rev ?? null,
    drawingFilePath: r?.drawingFilePath ?? null,
    drawingNo: r?.drawingNo ?? null,
  };
}
