// ADR-235 Phase B — Purchase Request in the standard Cancel.
//
// A live PR (not cancelled, balance not short closed) with NOTHING on a live
// purchase order may be cancelled. The worker reuses the PR's one "dead PR"
// writer (pr-cancel-writer.ts markPrCancelledTx — shared with Reject): status
// → 'cancelled' conditionally on the status read under the lock, who / when /
// why stamped, the JC op(s) it was raised against handed back.
//
// One refusal rule — purchaseRequestCancelBlockers — used by the preview, by
// the Cancel Request service (request + approve) and again by the worker.
// No rights check here: the Cancel Request service checks pr_create ticks.

import { ActivityAction, type CancelBlocker } from '@innovic/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { purchaseRequests } from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { ConflictError, NotFoundError } from '../../lib/errors';
import { blockerRefusal } from '../cancel-requests/messages';
import { emitActivityLog } from '../activity-log/service';
import {
  PR_BALANCE_CLOSED_REASON,
  prHeaderLinkBlockReason,
  prOrderedBlockReason,
  prStatusWord,
} from './cancel-text';
import { markPrCancelledTx } from './pr-cancel-writer';
import { loadOrderedQty } from './service';

type PrRow = typeof purchaseRequests.$inferSelect;

/** Read the PR; `forUpdate` locks it (request / approve), the preview reads
 *  without a lock. null = not found in this company. */
export async function lockPurchaseRequestForCancel(
  tx: DbTransaction,
  companyId: string,
  id: string,
  forUpdate: boolean,
): Promise<PrRow | null> {
  const q = tx
    .select()
    .from(purchaseRequests)
    .where(
      and(
        eq(purchaseRequests.id, id),
        eq(purchaseRequests.companyId, companyId),
        isNull(purchaseRequests.deletedAt),
      ),
    )
    .limit(1);
  const rows = forUpdate ? await q.for('update') : await q;
  return rows[0] ?? null;
}

/**
 * THE PR cancel refusal rule. Each live PO line that holds quantity of this PR
 * is named — the same arithmetic as the PR's ordered figure (liveOrderedQtySql:
 * a cancelled PO holds nothing, a short-closed one holds what it received) —
 * plus the pre-0103 header-only link and a short-closed balance.
 */
export async function purchaseRequestCancelBlockers(
  tx: DbTransaction,
  companyId: string,
  id: string,
): Promise<CancelBlocker[]> {
  const pr = await lockPurchaseRequestForCancel(tx, companyId, id, false);
  if (!pr || pr.status === 'cancelled') return [];
  const out: CancelBlocker[] = [];

  const lines = (await tx.execute(sql`
    SELECT po.id AS "poId", po.code AS "poCode", pol.line_no AS "lineNo",
      (po.short_closed_at IS NOT NULL) AS "shortClosed",
      (CASE WHEN po.short_closed_at IS NOT NULL THEN COALESCE(pol.received_qty, 0)
            ELSE pol.qty END)::float8 AS qty
    FROM public.purchase_order_lines pol
    JOIN public.purchase_orders po ON po.id = pol.purchase_order_id
    WHERE pol.source_pr_id = ${id}::uuid AND po.company_id = ${companyId}::uuid
      AND pol.deleted_at IS NULL AND po.deleted_at IS NULL AND po.status <> 'cancelled'
      AND (CASE WHEN po.short_closed_at IS NOT NULL THEN COALESCE(pol.received_qty, 0)
                ELSE pol.qty END) > 0
    ORDER BY po.code, pol.line_no
  `)) as unknown as Array<{
    poId: string;
    poCode: string;
    lineNo: number;
    shortClosed: boolean;
    qty: number;
  }>;
  for (const l of lines) {
    out.push({
      docLabel: 'PO',
      docNo: l.poCode,
      href: `/purchase-orders/${l.poId}`,
      reason: prOrderedBlockReason(l.lineNo, Number(l.qty), l.shortClosed),
    });
  }

  // LEGACY (pre-0103): header po_id with no PO lines reads as FULLY ordered
  // (deriveOrderedQty) — same answer here, so the two cannot disagree.
  if (lines.length === 0 && pr.poId && (await loadOrderedQty(tx, pr)) > 0) {
    const hdr = (await tx.execute(sql`
      SELECT code FROM public.purchase_orders
      WHERE id = ${pr.poId}::uuid AND company_id = ${companyId}::uuid
    `)) as unknown as Array<{ code: string }>;
    out.push({
      docLabel: 'PO',
      docNo: hdr[0]?.code ?? '—',
      href: `/purchase-orders/${pr.poId}`,
      reason: prHeaderLinkBlockReason(Number(pr.qty)),
    });
  }

  if (pr.balanceClosedAt !== null) {
    out.push({ docLabel: 'PR', docNo: pr.code, href: null, reason: PR_BALANCE_CLOSED_REASON });
  }
  return out;
}

/**
 * The PR cancel worker, run only by an approved Cancel Request (ADR-235), in
 * the caller's transaction. Locks the PR FIRST (a second cancel / a racing
 * Create PO waits here, then re-reads), re-checks the rule under the lock,
 * then runs the shared writer and logs CANCEL with the request's reason.
 */
export async function cancelPurchaseRequestTx(
  tx: DbTransaction,
  companyId: string,
  id: string,
  reason: string,
  user: AuthContext,
): Promise<void> {
  const pr = await lockPurchaseRequestForCancel(tx, companyId, id, true);
  if (!pr) throw new NotFoundError('PR not found. It may have been moved to Trash.');
  if (pr.status === 'cancelled') {
    throw new ConflictError(`PR ${pr.code} is already Cancelled. Reload the page.`);
  }
  const blockers = await purchaseRequestCancelBlockers(tx, companyId, id);
  if (blockers.length > 0) throw new ConflictError(blockerRefusal(pr.code, blockers), { blockers });

  const trimmed = reason.trim();
  const released = await markPrCancelledTx(tx, pr, 'cancelled', trimmed, user);
  await emitActivityLog(
    tx,
    {
      action: ActivityAction.Cancel,
      entity: 'PurchaseRequest',
      entityId: pr.id,
      refId: pr.code,
      qty: pr.qty,
      reason: trimmed,
      changes: [
        {
          field: 'status',
          label: 'PR Status',
          before: prStatusWord(pr.status),
          after: 'Cancelled',
        },
      ],
      detail:
        `${pr.code} cancelled: ${trimmed}` +
        (released > 0 ? ` — ${released} JC operation(s) freed` : ''),
    },
    companyId,
    user,
  );
}

/**
 * ADR-235 — refuse to order from a PR while a Cancel Request waits on it. The
 * PO create paths call this right after locking the PR rows FOR UPDATE (the
 * cancel request locks the same row first, so the two serialise). One query
 * for any number of PRs — the batch convert takes many.
 */
export async function assertPrsHaveNoPendingCancel(
  tx: DbTransaction,
  companyId: string,
  prIds: readonly string[],
): Promise<void> {
  if (prIds.length === 0) return;
  const rows = (await tx.execute(sql`
    SELECT doc_code AS "docCode"
    FROM public.cancel_requests
    WHERE company_id = ${companyId}::uuid AND doc_type = 'purchase_request'
      AND doc_id IN (${sql.join(
        prIds.map((p) => sql`${p}::uuid`),
        sql`, `,
      )})
      AND status = 'pending' AND deleted_at IS NULL
    ORDER BY doc_code
    LIMIT 1
  `)) as unknown as Array<{ docCode: string }>;
  const hit = rows[0];
  if (hit) {
    throw new ConflictError(
      `Cannot create a PO from PR ${hit.docCode}: it has a cancel request pending — decide it first.`,
    );
  }
}
