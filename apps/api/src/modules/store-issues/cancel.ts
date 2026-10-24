// Item Issue — Cancel (ADR-235; was Reverse, ADR-189). Only via an approved
// Cancel Request: the whole slip is put back by OPPOSITE ledger entries ('in'
// of each line, source 'store_return'), never by editing the 'out'. Stays on
// the register, stamped reversed_at / reversed_by / reversal_reason.
//
// Only while nothing was returned from it — after a Return, use Return — and,
// on an assembly SO, only while its parts are still out (not fitted).

import {
  ActivityAction,
  fmtOpSrNo,
  ISSUE_AGAINST_LABELS,
  type CancelBlocker,
  type IssueAgainst,
} from '@innovic/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { storeIssues } from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { lockSoRow } from '../../lib/assembly-parts';
import { ConflictError, NotFoundError } from '../../lib/errors';
import { assertRowUpdated } from '../../lib/row-lock';
import { postStockMove, roundQty } from '../../lib/stock-ledger';
import { emitActivityLog } from '../activity-log/service';
import { blockerRefusal } from '../cancel-requests/messages';
import { giveBackLineReservations, reverseFittedLines } from './assembly';
import { readSlipLines, today } from './slip';

/** Read the slip; `forUpdate` locks it (request / approve), the preview reads
 *  without a lock. null = not found in this company. */
export async function lockStoreIssueForCancel(
  tx: DbTransaction,
  companyId: string,
  id: string,
  forUpdate: boolean,
): Promise<typeof storeIssues.$inferSelect | null> {
  const q = tx
    .select()
    .from(storeIssues)
    .where(
      and(
        eq(storeIssues.id, id),
        eq(storeIssues.companyId, companyId),
        isNull(storeIssues.deletedAt),
      ),
    )
    .limit(1);
  const rows = forUpdate ? await q.for('update') : await q;
  return rows[0] ?? null;
}

/**
 * THE Item Issue cancel refusal rule (one place — the worker and the Cancel
 * preview both call it):
 *   · a line with a Return already recorded — use Return for what is still out;
 *   · a slip with no lines — there is no stock to put back;
 *   · an assembly-SO slip whose parts are already fitted (P34) — Undo the unit;
 *   · a Job Card slip once work has started on the card's first operation.
 */
export async function storeIssueCancelBlockers(
  tx: DbTransaction,
  companyId: string,
  id: string,
): Promise<CancelBlocker[]> {
  const iss = await lockStoreIssueForCancel(tx, companyId, id, false);
  if (!iss) return [];
  const { lines, returned } = await readSlipLines(tx, iss.id);
  const out: CancelBlocker[] = [];
  for (const l of lines) {
    const back = returned.get(l.id) ?? 0;
    if (back > 0) {
      out.push({
        docLabel: 'Return',
        docNo: `${iss.code} Ln ${l.lineNo}`,
        href: null,
        reason: `${l.itemCodeText} ${back} already returned — use Return for what is still out`,
      });
    }
  }
  if (lines.length === 0) {
    out.push({
      docLabel: 'Item Issue',
      docNo: iss.code,
      href: null,
      reason: 'it has no items on it, so there is no stock to put back',
    });
  }
  // Owner rule (ADR-235 Phase C): an issue to a Job Card cannot be cancelled
  // once work has started on the card's FIRST operation (lowest live op) — any
  // production / QC entry on it (net op_log qty incl. rejects > 0; reversed
  // entries net to 0) or a running session. The material is in use; what is
  // unused goes back by Return.
  if (iss.jobCardId) {
    const started = (await tx.execute(sql`
      SELECT jc.code, o.op_seq AS "opSeq"
      FROM public.job_cards jc
      JOIN LATERAL (
        SELECT o1.id, o1.op_seq FROM public.jc_ops o1
        WHERE o1.job_card_id = jc.id AND o1.deleted_at IS NULL
        ORDER BY o1.op_seq
        LIMIT 1
      ) o ON true
      WHERE jc.id = ${iss.jobCardId}::uuid AND jc.company_id = ${companyId}::uuid
        AND (
          COALESCE((SELECT SUM(l.qty + l.reject_qty) FROM public.op_log l
                    WHERE l.jc_op_id = o.id), 0) > 0
          OR EXISTS (SELECT 1 FROM public.running_ops r
                     WHERE r.jc_op_id = o.id AND r.status = 'running')
        )
    `)) as unknown as Array<{ code: string; opSeq: number }>;
    const hit = started[0];
    if (hit) {
      out.push({
        docLabel: 'Job Card',
        docNo: hit.code,
        href: `/job-cards/${iss.jobCardId}`,
        reason: `work has started on Op ${fmtOpSrNo(Number(hit.opSeq))} — the material is in use; use Return for what is unused`,
      });
    }
  }
  if (iss.issueAgainst === 'assembly_so' && iss.salesOrderId && lines.length > 0) {
    const fitted = await reverseFittedLines(tx, companyId, iss.salesOrderId, lines);
    if (fitted.length > 0) {
      const so = (await tx.execute(sql`
        SELECT code FROM public.sales_orders
        WHERE id = ${iss.salesOrderId}::uuid AND company_id = ${companyId}::uuid
      `)) as unknown as Array<{ code: string }>;
      out.push({
        docLabel: 'Assembly',
        docNo: so[0]?.code ?? 'SO',
        href: `/assemblies/${iss.salesOrderId}`,
        reason:
          `${fitted.map((l) => l.itemCodeText).join(', ')} already fitted into assembled units — ` +
          `Undo the unit first, or Return what is still out`,
      });
    }
  }
  return out;
}

/**
 * The ONE Item Issue cancel writer, run only by an approved Cancel Request
 * (ADR-235). In-tx body, no rights check — the Cancel Request checks the ticks.
 */
export async function cancelStoreIssueTx(
  tx: DbTransaction,
  companyId: string,
  id: string,
  reason: string,
  user: AuthContext,
): Promise<void> {
  // Slip first, then (assembly SO) the SO row — the order Return takes too.
  const iss = await lockStoreIssueForCancel(tx, companyId, id, true);
  if (!iss) throw new NotFoundError('Item Issue not found.');
  if (iss.reversedAt) throw new ConflictError(`${iss.code} is already cancelled.`);
  const assemblySoId =
    iss.issueAgainst === 'assembly_so' && iss.salesOrderId ? iss.salesOrderId : null;
  // Same lock assembly Complete takes, so a unit cannot be fitted between the
  // Still Out check and the move.
  if (assemblySoId) await lockSoRow(tx, companyId, assemblySoId);

  const blockers = await storeIssueCancelBlockers(tx, companyId, id);
  if (blockers.length > 0) {
    throw new ConflictError(blockerRefusal(iss.code, blockers), { blockers });
  }
  const { lines } = await readSlipLines(tx, iss.id);

  const date = today();
  const done: string[] = [];
  const byLine = new Map<string, string>();
  for (const line of [...lines].sort((a, b) => a.itemId.localeCompare(b.itemId))) {
    const mv = await postStockMove(tx, {
      companyId,
      itemId: line.itemId,
      txnType: 'in',
      qty: line.qty,
      sourceType: 'store_return',
      sourceRef: `${iss.code} reversal · ${line.itemCodeText}`,
      remarks: `Item Issue cancelled · ${reason}`,
      txnDate: date,
      userId: user.id,
      itemCodeText: line.itemCodeText,
      guard: 'none',
    });
    byLine.set(line.id, mv.id);
    done.push(`${line.itemCodeText} × ${line.qty} (stock ${mv.stockBefore} → ${mv.stockAfter})`);
  }
  const firstTxnId = byLine.get(lines[0]!.id) ?? null;
  // ADR-193 3c — what the slip used of the SO's reservation is held again.
  if (assemblySoId) {
    await giveBackLineReservations(tx, { companyId, soId: assemblySoId, userId: user.id }, lines);
  }

  const now = new Date();
  // §20.2 — cancel once: only a slip still not reversed moves.
  const moved = await tx
    .update(storeIssues)
    .set({
      reversedAt: now,
      reversedBy: user.id,
      reversalReason: reason,
      reversalStoreTransactionId: firstTxnId,
      updatedBy: user.id,
      updatedAt: now,
    })
    .where(and(eq(storeIssues.id, iss.id), isNull(storeIssues.reversedAt)))
    .returning({ id: storeIssues.id });
  assertRowUpdated(moved, iss.code);

  await emitActivityLog(
    tx,
    {
      action: ActivityAction.Cancel,
      entity: 'StoreIssue',
      entityId: iss.id,
      refId: iss.code,
      qty: roundQty(lines.reduce((sum, l) => sum + Number(l.qty), 0)),
      reason,
      detail: `${iss.code} (${ISSUE_AGAINST_LABELS[iss.issueAgainst as IssueAgainst] ?? iss.issueAgainst}) cancelled — put back ${done.join(', ')}`,
    },
    companyId,
    user,
  );
}
