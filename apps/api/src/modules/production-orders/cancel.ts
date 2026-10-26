// ADR-235 Phase C (part 2) — Production Order in the standard Cancel.
//
// A Production Order may be cancelled ONLY while it is still 'open' with
// nothing received into stock and nothing booked from it. Cancelling it is
// "as if it never existed":
//   · its OWN Job Card(s) (job_cards.production_order_id = this order) are
//     cancelled with it, in the same transaction, by the Job Card module's own
//     worker (cancelJobCardTx, viaProductionOrder) — their own refusal rule
//     (jobCardCancelBlockers) blocks this cancel too, prefixed with the card;
//   · the order is stamped deleted_at + cancel_reason / cancelled_at (same
//     instant) / cancelled_by (0221). There is NO 'cancelled' status — the
//     CHECK and ~10 SQL readers of production_orders.status stay as they are;
//     every reader that skips deleted_at drops a cancelled order;
//   · the plan gets its Pending back through shiftPlanPending — the same helper
//     a stop uses, under the same plan lock createProductionOrder takes — so a
//     plan stamped 'jc_created' by this order goes back to 'planned';
//   · plans.jc_id stops pointing at the cancelled card (re-pointed at the
//     newest live order's card, as Short Close does; null when none is left).
//
// One refusal rule — productionOrderCancelBlockers — used by the preview, by
// the Cancel Request service (request + approve) and again by the worker under
// its locks. No rights check here: the Cancel Request service checks the
// prodorder_create ticks.
//
// Lock order: the order row (the Cancel Request service locks it first), then
// its plan, then its Job Card(s) in id order — the order Close / Short Close /
// Reverse Close use (order → plan). createProductionOrder locks the plan and
// then INSERTS the order, so it never waits on an order row.

import {
  ActivityAction,
  PRODUCTION_ORDER_STATUS_LABEL,
  type CancelBlocker,
  type CancelEffect,
} from '@innovic/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { plans, productionOrders } from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { planCoverage } from '../../lib/production-order-cap';
import { readPlanOrderCoverage } from '../../lib/plan-order-coverage';
import { labelOf } from '../../lib/status-labels';
import { emitActivityLog } from '../activity-log/service';
import { blockerRefusal } from '../cancel-requests/messages';
import { cancelJobCardTx, jobCardCancelBlockers, lockJobCardForCancel } from '../job-cards/cancel';
import { shiftPlanPending } from './service';

export interface ProductionOrderCancelHead {
  id: string;
  code: string;
  status: string;
  planId: string;
  planCodeText: string;
  orderQty: number;
  creditedQty: number | null;
  jobCardId: string;
  jcCodeText: string | null;
  deletedAt: unknown;
  cancelledAt: unknown;
}

/** Read the order — cancelled AND trashed ones included (both stamp
 *  deleted_at; the caller tells them apart). `forUpdate` locks it (request /
 *  approve / the worker); the preview reads without a lock. null = not in this
 *  company. */
export async function lockProductionOrderForCancel(
  tx: DbTransaction,
  companyId: string,
  id: string,
  forUpdate: boolean,
): Promise<ProductionOrderCancelHead | null> {
  const rows = (await tx.execute(sql`
    SELECT id, code, status, plan_id AS "planId", plan_code_text AS "planCodeText",
           order_qty AS "orderQty", credited_qty AS "creditedQty",
           job_card_id AS "jobCardId", jc_code_text AS "jcCodeText",
           deleted_at AS "deletedAt", cancelled_at AS "cancelledAt"
      FROM public.production_orders
     WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid
     ${forUpdate ? sql`FOR UPDATE` : sql``}
  `)) as unknown as ProductionOrderCancelHead[];
  return rows[0] ?? null;
}

/** The order's OWN live Job Cards (job_cards.production_order_id), id order —
 *  the order the worker locks them in. Rework / repair children carry no
 *  production_order_id; they are the Job Card rule's to refuse. */
async function ownJobCardIds(tx: DbTransaction, companyId: string, id: string): Promise<string[]> {
  const rows = (await tx.execute(sql`
    SELECT jc.id FROM public.job_cards jc
     WHERE jc.production_order_id = ${id}::uuid
       AND jc.company_id = ${companyId}::uuid
       AND jc.deleted_at IS NULL
     ORDER BY jc.id
  `)) as unknown as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

/**
 * THE Production Order cancel refusal rule (one place — the worker under its
 * locks, the Cancel Request service and the preview all call it):
 *  · stock received (credited_qty > 0, or a close in the ledger not reversed)
 *    — reverse the Stock Received first;
 *  · status not 'open' (partially closed / closed / short closed);
 *  · stock booked from this order (a live, unspent so_stock_reservations row);
 *  · each of its own Job Cards' blockers (jobCardCancelBlockers with
 *    viaProductionOrder — which also names live OSP PRs on its ops).
 * A cancelled / trashed / missing order has nothing to refuse (the lock step
 * says so).
 */
export async function productionOrderCancelBlockers(
  tx: DbTransaction,
  companyId: string,
  id: string,
): Promise<CancelBlocker[]> {
  const head = await lockProductionOrderForCancel(tx, companyId, id, false);
  if (!head || head.deletedAt != null) return [];
  const out: CancelBlocker[] = [];
  const href = `/production-orders/${id}`;

  // A close not reversed = pieces still in stock from this order.
  const openCloses = (await tx.execute(sql`
    SELECT COALESCE(SUM(c.qty), 0)::int AS qty, COUNT(*)::int AS n
      FROM public.production_order_closes c
     WHERE c.production_order_id = ${id}::uuid
       AND c.company_id = ${companyId}::uuid
       AND c.deleted_at IS NULL
       AND c.is_reversal = false
       AND NOT EXISTS (
         SELECT 1 FROM public.production_order_closes r
          WHERE r.reverses_close_id = c.id AND r.deleted_at IS NULL)
  `)) as unknown as Array<{ qty: number; n: number }>;
  const credited = Number(head.creditedQty ?? 0);
  const unreversed = Number(openCloses[0]?.n ?? 0);
  if (credited > 0 || unreversed > 0) {
    const qty = Math.max(credited, Number(openCloses[0]?.qty ?? 0));
    out.push({
      docLabel: 'Stock Received',
      docNo: head.code,
      href,
      reason: `${qty} pcs received into stock — reverse the Stock Received first`,
    });
  }

  if (head.status !== 'open') {
    const label = labelOf(PRODUCTION_ORDER_STATUS_LABEL, head.status);
    out.push({
      docLabel: 'Production Order',
      docNo: head.code,
      href,
      reason: `is ${label} — only an Open order with nothing received can be cancelled`,
    });
  }

  const booked = (await tx.execute(sql`
    SELECT r.so_code_text AS "soCode", r.line_no AS "lineNo",
           (r.qty - r.consumed_qty - r.released_qty)::int AS qty
      FROM public.so_stock_reservations r
     WHERE r.production_order_id = ${id}::uuid
       AND r.company_id = ${companyId}::uuid
       AND r.deleted_at IS NULL
       AND r.status IN ('active', 'partially_consumed')
     ORDER BY r.so_code_text, r.line_no
  `)) as unknown as Array<{ soCode: string; lineNo: number; qty: number }>;
  for (const b of booked) {
    out.push({
      docLabel: 'Stock Booking',
      docNo: `${b.soCode} Ln ${b.lineNo}`,
      href: null,
      reason: `${b.qty} pcs booked from ${head.code} — release the booking first`,
    });
  }

  for (const jcId of await ownJobCardIds(tx, companyId, id)) {
    const jc = await lockJobCardForCancel(tx, companyId, jcId, false);
    if (!jc || jc.cancelled) continue;
    const jcBlockers = await jobCardCancelBlockers(tx, companyId, jcId, {
      viaProductionOrder: true,
    });
    for (const b of jcBlockers) out.push({ ...b, reason: `${jc.code}: ${b.reason}` });
  }
  return out;
}

/** What the cancel will do — the Cancel preview's lines. */
export async function productionOrderCancelEffects(
  tx: DbTransaction,
  companyId: string,
  id: string,
): Promise<CancelEffect[]> {
  const head = await lockProductionOrderForCancel(tx, companyId, id, false);
  if (!head || head.deletedAt != null) return [];
  const out: CancelEffect[] = [];

  const planRows = await tx
    .select({ code: plans.code, planQty: plans.planQty, planStatus: plans.planStatus })
    .from(plans)
    .where(and(eq(plans.id, head.planId), eq(plans.companyId, companyId), isNull(plans.deletedAt)))
    .limit(1);
  const plan = planRows[0];
  if (plan) {
    // An Open order covers its full Order Qty (ORDER_COVERED_QTY_SQL), so the
    // cancel frees exactly what the order took — capped by the plan's own qty.
    const { coveredQty } = await readPlanOrderCoverage(tx, head.planId);
    const planQty = Number(plan.planQty);
    const before = planCoverage(planQty, coveredQty);
    const after = planCoverage(planQty, coveredQty - head.orderQty);
    const back = after.pendingQty - before.pendingQty;
    if (back > 0) {
      const reopens = plan.planStatus === 'jc_created';
      out.push({
        kind: 'reopen',
        text: `${plan.code}: ${back} pcs back to Pending${reopens ? ' (plan re-opens)' : ''}`,
        qty: back,
      });
    }
  }

  for (const jcId of await ownJobCardIds(tx, companyId, id)) {
    const jc = await lockJobCardForCancel(tx, companyId, jcId, false);
    if (!jc || jc.cancelled) continue;
    out.push({ kind: 'note', text: `${jc.code} is cancelled with it`, qty: null });
  }
  out.push({ kind: 'note', text: 'No stock moves — nothing was received', qty: null });
  return out;
}

/**
 * The ONE Production Order cancel writer, run only by an approved Cancel
 * Request (ADR-235), in the caller's transaction. No rights check — the Cancel
 * Request checks the ticks.
 */
export async function cancelProductionOrderTx(
  tx: DbTransaction,
  companyId: string,
  id: string,
  reason: string,
  user: AuthContext,
): Promise<{ code: string }> {
  const trimmed = (reason ?? '').trim();
  if (!trimmed) throw new ValidationError('Reason is required to cancel a Production Order.');

  // 1. The order — then re-check it is live (two cancels, or a cancel and a
  //    delete, queue here and the second one sees deleted_at).
  const head = await lockProductionOrderForCancel(tx, companyId, id, true);
  if (!head) throw new NotFoundError('Production Order not found. Refresh the page.');
  if (head.cancelledAt != null) {
    throw new ConflictError(`${head.code} is already cancelled. Refresh the page.`);
  }
  if (head.deletedAt != null) {
    throw new ConflictError(`${head.code} has been moved to Trash. Refresh the page.`);
  }

  // 2. The plan — the lock createProductionOrder and every stop take, so a
  //    create running now either sees this order still covering its qty or
  //    waits and re-reads the freed Pending. (shiftPlanPending re-takes it.)
  await tx
    .select({ id: plans.id })
    .from(plans)
    .where(and(eq(plans.id, head.planId), eq(plans.companyId, companyId)))
    .limit(1)
    .for('update');

  // 3. Its own Job Cards, id order.
  const jcIds = await ownJobCardIds(tx, companyId, id);
  const liveCards: Array<{ id: string; code: string }> = [];
  for (const jcId of jcIds) {
    const jc = await lockJobCardForCancel(tx, companyId, jcId, true);
    if (jc && !jc.cancelled) liveCards.push({ id: jc.id, code: jc.code });
  }

  // 4. The refusal rule, under the locks — before anything moves.
  const blockers = await productionOrderCancelBlockers(tx, companyId, id);
  if (blockers.length > 0) {
    throw new ConflictError(blockerRefusal(head.code, blockers), { blockers });
  }

  // 5. The Job Cards — the Job Card module's own worker (one writer).
  for (const jc of liveCards) {
    await cancelJobCardTx(tx, companyId, jc.id, trimmed, user, { viaProductionOrder: true });
  }

  // 6. The order, between two reads of the plan's Pending (shiftPlanPending):
  //    stamped deleted_at + cancel_*, conditional on the status locked above.
  const now = new Date();
  const shift = await shiftPlanPending(
    tx,
    { planId: head.planId, companyId, poCode: head.code, how: 'cancel', user },
    async () => {
      const written = await tx
        .update(productionOrders)
        .set({
          deletedAt: now,
          deletedBy: user.id,
          cancelReason: trimmed,
          cancelledAt: now,
          cancelledBy: user.id,
          updatedAt: now,
          updatedBy: user.id,
        })
        .where(
          and(
            eq(productionOrders.id, id),
            eq(productionOrders.companyId, companyId),
            eq(productionOrders.status, head.status),
            isNull(productionOrders.deletedAt),
          ),
        )
        .returning({ id: productionOrders.id });
      if (written.length === 0) {
        throw new ConflictError(
          `${head.code} has just been changed by someone else. Refresh the page.`,
        );
      }
    },
  );

  // 7. plans.jc_id must stop opening the cancelled card: the newest live
  //    order's card (a still-running one first, as Short Close prefers), else
  //    nothing — exactly what it would read had this order never been raised.
  const nextJc = (await tx.execute(sql`
    SELECT po.job_card_id AS "jobCardId"
      FROM public.production_orders po
     WHERE po.plan_id = ${head.planId}::uuid
       AND po.company_id = ${companyId}::uuid
       AND po.deleted_at IS NULL
     ORDER BY (po.status <> 'short_closed') DESC, po.created_at DESC, po.code DESC
     LIMIT 1
  `)) as unknown as Array<{ jobCardId: string | null }>;
  await tx
    .update(plans)
    .set({ jcId: nextJc[0]?.jobCardId ?? null, updatedAt: now, updatedBy: user.id })
    .where(and(eq(plans.id, head.planId), eq(plans.jcId, head.jobCardId)));

  const returned = shift ? shift.pendingAfter - shift.pendingBefore : 0;
  const planCode = shift?.planCode ?? head.planCodeText;
  await emitActivityLog(
    tx,
    {
      action: ActivityAction.Cancel,
      entity: 'ProductionOrder',
      entityId: head.id,
      refId: head.code,
      qty: head.orderQty,
      reason: trimmed,
      detail:
        `${head.code} cancelled — ${returned} back to Pending on plan ${planCode}` +
        (shift ? ` (Pending ${shift.pendingBefore} → ${shift.pendingAfter})` : '') +
        (shift?.reopened ? ', plan re-opened' : '') +
        (liveCards.length > 0
          ? `; Job Card ${liveCards.map((c) => c.code).join(', ')} cancelled with it`
          : '') +
        `. Reason: ${trimmed}`,
    },
    companyId,
    user,
  );

  return { code: head.code };
}
