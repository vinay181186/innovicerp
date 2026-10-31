// The Route Card's Item + Drawing Rev drawing (0232). The "which card is
// the card for this Item + Rev" lookup lives in ONE place —
// lib/route-card-for-rev.ts readRouteCardForItemRev (§21) — re-exported here
// for the Route Card writers.

import { eq } from 'drizzle-orm';
import { itemRevisions } from '../../db/schema';
import type { DbTransaction } from '../../db/with-user-context';

export { readRouteCardForItemRev } from '../../lib/route-card-for-rev';

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
