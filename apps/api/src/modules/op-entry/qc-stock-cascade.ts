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

import { opSrNo } from '@innovic/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import { jcOps, jobCards, storeTransactions } from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { isProductionOrderLinkedJc } from '../../lib/production-order-link';

/**
 * Recovery-child stock guard (ADR-069: finished stock is credited exactly ONCE
 * per piece). On a rework/repair CHILD job card the accepted pieces do not stop
 * at the child's terminal QC: the recovery cascade (nc-register/recovery
 * onRecoveryJobCardQc) re-injects them into the PARENT route at the origin op,
 * and the parent's own terminal QC credits them when they get there. Crediting
 * them on the child as well would book every recovered piece twice. The one
 * case where the child IS the last inspection the pieces will ever get is when
 * the origin op is the parent's terminal op — the re-injected op_log row is
 * written directly, not through submitQcLog, so nothing else credits them and
 * the child must.
 *
 * Returns true for an ordinary (non-recovery) job card, or when the job card is
 * not found, so callers can gate tryApplyQcStockCascade on it unconditionally.
 *
 * ONE implementation, used by BOTH writers of a terminal-QC stock credit:
 *   - op-entry/service.submitQcLog (a keyed QC log)
 *   - incoming-qc/service.mirrorIncomingQcOntoNextQcOp (the mirrored qc row an
 *     Incoming QC writes onto the following QC op)
 * Keep them in lock-step by changing this function, not either caller.
 */
export async function recoveryChildCreditsStock(
  tx: DbTransaction,
  companyId: string,
  jobCardId: string,
): Promise<boolean> {
  const loadJc = async (id: string) =>
    (
      await tx
        .select({
          recoveryKind: jobCards.recoveryKind,
          parentJobCardId: jobCards.parentJobCardId,
          originOpSeq: jobCards.originOpSeq,
        })
        .from(jobCards)
        .where(and(eq(jobCards.id, id), eq(jobCards.companyId, companyId)))
        .limit(1)
    )[0];

  const jc = await loadJc(jobCardId);
  if (!jc?.recoveryKind || !jc.parentJobCardId) return true;

  // Walk to the TOP of the recovery chain (QC-NC audit 2026-09-21, gap 5).
  // The pieces a child accepts climb ALL the way up — every ancestor NC is
  // credited and every ancestor's origin op gets a re-inject row — so the
  // question is never "is my origin op my parent's last op" but "when the
  // pieces finally land on the TOP (non-recovery) job card, is there any
  // inspection left after that op". Comparing against the IMMEDIATE parent
  // was right for a first-level child and always-true for a grandchild: a
  // recovery child's last op is the very QC the next NC is raised on, so
  // P-RW1-RW1 (origin = P-RW1's QC, P-RW1's last op) credited stock even when
  // the pieces then climbed to P's op 20 and P's op 30 QC credited them again.
  //
  // Follow parent_job_card_id while the card is itself a recovery child. The
  // LAST recovery child visited is the one whose parent is the top JC; its
  // origin_op_seq is the op the pieces re-enter the top route at.
  let firstLevel = jc; // the recovery child whose parent is the top JC
  let topId: string = jc.parentJobCardId;
  for (let guard = 0; guard < 50; guard++) {
    const above = await loadJc(topId);
    if (!above) return true; // broken link — behave as an ordinary JC (as before)
    if (!above.recoveryKind || !above.parentJobCardId) break; // reached the top
    firstLevel = above;
    topId = above.parentJobCardId;
  }

  // Credit only when the top-route re-entry op IS the top JC's last op: then
  // the re-inject row written there (directly, never through submitQcLog) is
  // the last time these pieces are ever inspected and nothing else credits
  // them. Any earlier re-entry op means the top JC's own terminal QC will.
  const topLast = await tx
    .select({ opSeq: jcOps.opSeq })
    .from(jcOps)
    .where(and(eq(jcOps.jobCardId, topId), sql`${jcOps.deletedAt} IS NULL`))
    .orderBy(desc(jcOps.opSeq))
    .limit(1);
  const topLastSeq = topLast[0]?.opSeq ?? null;
  return topLastSeq != null && topLastSeq === firstLevel.originOpSeq;
}

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

  // ADR-170: a Job Card built by a Production Order (or a rework/repair child
  // of one) is credited to stock ONCE, when that Production Order is closed —
  // never here. Sits after the last-op / item resolution and before any write
  // so BOTH callers (submitQcLog and the Incoming-QC mirror) are covered by
  // this one line. Old JCs (no PO in their ancestry) fall through unchanged.
  if (await isProductionOrderLinkedJc(tx, ctx.jobCardId)) return { fired: false };

  // ADR-106 (supersedes ADR-105): a JWSO Job Card credits stock here exactly
  // like an SO one. The finished parts ARE physically in the store between QC
  // and the return, so the ledger should show them. ADR-105 suppressed this
  // credit instead, which was only half a fix — the real defect was the
  // MISSING debit when the goods leave. The JW Return Challan now posts that
  // 'out' row (jw-returns/service.ts), so the pair balances the same way
  // qc_accept and dispatch do on the sales side.

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
      // display rule — see opSrNo in @innovic/shared
      sourceRef: `${ctx.jcCode} Op #${opSrNo(ctx.opSeq)}`,
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
