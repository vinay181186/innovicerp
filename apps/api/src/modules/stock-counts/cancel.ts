// Stock Count — Cancel (ADR-235: only via an approved Cancel Request).
//
// A draft or submitted count has moved no stock, so a cancel only closes it.
// A posted count is never cancelled — it is corrected by a new count.

import { ActivityAction, type CancelBlocker } from '@innovic/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { stockCounts } from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { ConflictError, NotFoundError } from '../../lib/errors';
import { assertRowUpdated } from '../../lib/row-lock';
import { emitActivityLog } from '../activity-log/service';
import { blockerRefusal } from '../cancel-requests/messages';

/** Read the count header; `forUpdate` locks it (request / approve), the
 *  preview reads without a lock. null = not found in this company. */
export async function lockStockCountForCancel(
  tx: DbTransaction,
  companyId: string,
  id: string,
  forUpdate: boolean,
): Promise<typeof stockCounts.$inferSelect | null> {
  const q = tx
    .select()
    .from(stockCounts)
    .where(
      and(
        eq(stockCounts.id, id),
        eq(stockCounts.companyId, companyId),
        isNull(stockCounts.deletedAt),
      ),
    )
    .limit(1);
  const rows = forUpdate ? await q.for('update') : await q;
  return rows[0] ?? null;
}

/** THE Stock Count cancel refusal rule (worker + preview): a posted count. */
export async function stockCountCancelBlockers(
  tx: DbTransaction,
  companyId: string,
  id: string,
): Promise<CancelBlocker[]> {
  const h = await lockStockCountForCancel(tx, companyId, id, false);
  if (!h || h.status !== 'posted') return [];
  return [
    {
      docLabel: 'Stock Count',
      docNo: h.code,
      href: `/stock-counts/${h.id}`,
      reason: 'Posted — make a new Stock Count to correct it',
    },
  ];
}

/** The ONE Stock Count cancel writer (ADR-235). In-tx, no rights check. */
export async function cancelStockCountTx(
  tx: DbTransaction,
  companyId: string,
  id: string,
  reason: string,
  user: AuthContext,
): Promise<void> {
  const h = await lockStockCountForCancel(tx, companyId, id, true);
  if (!h) throw new NotFoundError('Stock Count not found.');
  if (h.status === 'cancelled') throw new ConflictError(`${h.code} is already cancelled.`);
  const blockers = await stockCountCancelBlockers(tx, companyId, id);
  if (blockers.length > 0) {
    throw new ConflictError(blockerRefusal(h.code, blockers), { blockers });
  }
  const now = new Date();
  // §20.2 — only from the status read under the lock above.
  const moved = await tx
    .update(stockCounts)
    .set({
      status: 'cancelled',
      cancelledAt: now,
      cancelledBy: user.id,
      cancelReason: reason,
      updatedAt: now,
      updatedBy: user.id,
    })
    .where(and(eq(stockCounts.id, id), eq(stockCounts.status, h.status)))
    .returning({ id: stockCounts.id });
  assertRowUpdated(moved, h.code);
  await emitActivityLog(
    tx,
    {
      action: ActivityAction.Cancel,
      entity: 'StockCount',
      entityId: h.id,
      refId: h.code,
      reason,
      detail: `${h.code} cancelled (${h.status})`,
    },
    companyId,
    user,
  );
}
