// QC last-op stock cascade (T-040f).
//
// Mirrors legacy stock-add at HTML L3923-3940 inside the legacy submitQcLog
// handler: when a QC log is against the LAST op of a JC AND qty (accepted)
// > 0, write a store_transactions ledger row with source_type='qc_accept'.
// `v_item_stock` (the on-hand-by-item view) automatically reflects the new
// balance — no items.stock_qty denormalisation per ADR-015 #11.
//
// Same shape as the GRN cascade (apps/api/src/modules/goods-receipt-notes/
// cascades.ts:applyStockCascade) — locks the items row with SELECT FOR
// UPDATE to serialise concurrent stock writes against the same item, reads
// current on-hand from v_item_stock, computes stockBefore + stockAfter,
// inserts the ledger row.
//
// Caller is op-entry/service.submitQcLog; this runs in the SAME tx so a
// rollback unwinds both the QC log and the stock row together.

import { and, desc, eq, sql } from 'drizzle-orm';
import { jcOps, jobCards, storeTransactions } from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';

export interface QcStockCascadeContext {
  companyId: string;
  jobCardId: string;
  jcCode: string;
  opSeq: number; // the op_seq of the QC log being submitted
  acceptedQty: number; // > 0 (caller checks before invoking)
  txnDate: string; // YYYY-MM-DD (matches the QC log's date)
}

export interface QcStockCascadeResult {
  /** True if a ledger row was written; false if this op wasn't the last op
   *  of the JC (no-op cascade). */
  fired: boolean;
  storeTransactionId?: string;
  stockBefore?: number;
  stockAfter?: number;
}

/**
 * If the QC log is against the last op of the JC, write a store_transactions
 * row crediting `acceptedQty` to the JC's item. No-op otherwise.
 */
export async function tryApplyQcStockCascade(
  tx: DbTransaction,
  ctx: QcStockCascadeContext,
  user: AuthContext,
): Promise<QcStockCascadeResult> {
  // Last-op check: highest op_seq on the JC (excluding soft-deleted ops).
  const lastOpRows = await tx
    .select({ opSeq: jcOps.opSeq })
    .from(jcOps)
    .where(and(eq(jcOps.jobCardId, ctx.jobCardId), sql`${jcOps.deletedAt} IS NULL`))
    .orderBy(desc(jcOps.opSeq))
    .limit(1);
  const lastOpSeq = lastOpRows[0]?.opSeq;
  if (lastOpSeq == null || lastOpSeq !== ctx.opSeq) {
    return { fired: false };
  }

  // Resolve the JC's itemId — required for the ledger + the v_item_stock lookup.
  const jcRows = await tx
    .select({ itemId: jobCards.itemId })
    .from(jobCards)
    .where(eq(jobCards.id, ctx.jobCardId))
    .limit(1);
  const itemId = jcRows[0]?.itemId;
  if (!itemId) return { fired: false };

  // Lock the items row to serialise concurrent stock writes on the same item.
  // Same pattern as GRN cascade (goods-receipt-notes/cascades.ts:170).
  await tx.execute(sql`SELECT 1 FROM public.items WHERE id = ${itemId}::uuid FOR UPDATE`);

  // Read current on-hand from v_item_stock; default to 0 when no prior txns.
  const balanceRows = (await tx.execute(sql`
    SELECT COALESCE(on_hand_qty, 0)::int AS on_hand
    FROM public.v_item_stock
    WHERE company_id = ${ctx.companyId}::uuid AND item_id = ${itemId}::uuid
  `)) as unknown as Array<{ on_hand: number }>;
  const stockBefore = Number(balanceRows[0]?.on_hand ?? 0);
  const stockAfter = stockBefore + ctx.acceptedQty;

  const inserted = await tx
    .insert(storeTransactions)
    .values({
      companyId: ctx.companyId,
      txnDate: ctx.txnDate,
      itemId,
      txnType: 'in',
      qty: ctx.acceptedQty,
      sourceType: 'qc_accept',
      sourceRef: `${ctx.jcCode} Op #${ctx.opSeq}`,
      stockBefore,
      stockAfter,
      remarks: `QC accept · last op · ${ctx.acceptedQty} pcs`,
      createdBy: user.id,
    })
    .returning({ id: storeTransactions.id });

  return {
    fired: true,
    storeTransactionId: inserted[0]!.id,
    stockBefore,
    stockAfter,
  };
}
