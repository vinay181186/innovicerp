// ADR-291 Step 4 — lower a Production Order's Order Qty by the pieces that have
// not started, so an Engineering Change can move them to the new Drawing Rev on
// a new order. The ONE writer that lowers production_orders.order_qty after
// create (§20.1); its Job Card's order_qty moves with it.
//
// §20.3 — every limit is read under the lock it protects, in one transaction:
//   1. production_orders row FOR UPDATE (as shortCloseProductionOrder);
//   2. the plan row FOR UPDATE (lockPlanRow — the lock createProductionOrder
//      takes), before any jc_ops row; shiftPlanPending re-takes it (a no-op in
//      the same transaction) and re-opens the plan's Pending;
//   3. the Job Card's FIRST operation FOR UPDATE — the op Op Entry locks before
//      it logs a start/complete — then "not started" (its available qty) and
//      "no running session" are re-read under that lock;
//   4. job_cards.order_qty last (jc_ops before job_cards — ADR-220 lock order).
// Two implements for the same order queue at step 1; the second re-reads the
// lowered qty and is refused if its pieces are no longer free, so the order
// never drops below what was started.

import { ActivityAction } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';
import { assertNoPendingCancel } from '../cancel-requests/pending-guard';
import { shiftPlanPending } from './service';

export interface ReduceProductionOrderQtyResult {
  poCode: string;
  jcCode: string | null;
  orderQtyBefore: number;
  orderQtyAfter: number;
}

/** The not-started qty of a Job Card: its first operation's available qty,
 *  less rework waiting to come back in (that is not new material). Read under
 *  the first op's lock by the caller. */
export async function readNotStartedQty(
  tx: DbTransaction,
  jobCardId: string,
): Promise<{ firstOpId: string | null; notStarted: number; running: boolean }> {
  const rows = (await tx.execute(sql`
    SELECT o.id,
           GREATEST(0, COALESCE(vos.available, 0) - COALESCE(vos.rework_pending_qty, 0))::numeric AS free,
           EXISTS (SELECT 1 FROM public.running_ops r
                    WHERE r.jc_op_id = o.id AND r.status = 'running') AS running
      FROM public.jc_ops o
      LEFT JOIN public.v_jc_op_status vos ON vos.jc_op_id = o.id
     WHERE o.job_card_id = ${jobCardId}::uuid AND o.deleted_at IS NULL
     ORDER BY o.op_seq
     LIMIT 1`)) as unknown as Array<{ id: string; free: string | number; running: boolean }>;
  const r = rows[0];
  if (!r) return { firstOpId: null, notStarted: 0, running: false };
  return { firstOpId: r.id, notStarted: Math.max(0, Number(r.free)), running: r.running === true };
}

/** Lock the plan row FOR UPDATE — step 2, always before the first op. */
async function lockPlanRow(tx: DbTransaction, companyId: string, planId: string): Promise<void> {
  await tx.execute(sql`
    SELECT id FROM public.plans
     WHERE id = ${planId}::uuid AND company_id = ${companyId}::uuid
       FOR UPDATE`);
}

/** Lock a Job Card's first live operation FOR UPDATE (Op Entry's lock). */
export async function lockFirstOp(tx: DbTransaction, jobCardId: string): Promise<void> {
  await tx.execute(sql`
    SELECT o.id FROM public.jc_ops o
     WHERE o.job_card_id = ${jobCardId}::uuid AND o.deleted_at IS NULL
     ORDER BY o.op_seq
     LIMIT 1
       FOR UPDATE`);
}

export async function reduceProductionOrderQty(
  tx: DbTransaction,
  args: {
    companyId: string;
    productionOrderId: string;
    qty: number;
    /** Why — written to both documents' History (e.g. "ECR IN-ECR-00001"). */
    reason: string;
    user: AuthContext;
  },
): Promise<ReduceProductionOrderQtyResult> {
  const { companyId, productionOrderId, qty, reason, user } = args;
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new ValidationError('Qty to move must be a whole number above 0.');
  }
  const poRows = (await tx.execute(sql`
    SELECT po.id, po.code, po.status, po.order_qty AS "orderQty", po.plan_id AS "planId",
           po.job_card_id AS "jobCardId", jc.code AS "jcCode"
      FROM public.production_orders po
      LEFT JOIN public.job_cards jc ON jc.id = po.job_card_id
     WHERE po.id = ${productionOrderId}::uuid AND po.company_id = ${companyId}::uuid
       AND po.deleted_at IS NULL
     LIMIT 1
       FOR UPDATE OF po`)) as unknown as Array<{
    id: string;
    code: string;
    status: string;
    orderQty: number;
    planId: string;
    jobCardId: string;
    jcCode: string | null;
  }>;
  const po = poRows[0];
  if (!po) throw new NotFoundError('Production Order not found. Refresh the page.');
  await assertNoPendingCancel(tx, 'production_order', po.id);
  if (po.status !== 'open' && po.status !== 'partially_closed') {
    throw new ConflictError(
      `${po.code} is ${po.status.replace('_', ' ')} — its qty cannot be moved.`,
    );
  }
  const before = Number(po.orderQty);
  if (qty >= before) {
    throw new ValidationError(
      `${po.code}: cannot move all ${before} — at least 1 piece must stay on the order. Short close it instead.`,
    );
  }

  await lockPlanRow(tx, companyId, po.planId);
  await lockFirstOp(tx, po.jobCardId);
  const ns = await readNotStartedQty(tx, po.jobCardId);
  const jcLabel = po.jcCode ?? 'the Job Card';
  if (ns.running) {
    throw new ConflictError(
      `${jcLabel}: the first operation is running now — stop it before moving pieces to the new Rev.`,
    );
  }
  if (ns.notStarted < qty) {
    throw new ConflictError(
      `${jcLabel}: only ${ns.notStarted} piece(s) not started — cannot move ${qty}. Reload the ECR.`,
    );
  }
  // ADR-203 — never below the customer material still issued to the card.
  const issued = (await tx.execute(sql`
    SELECT COALESCE(SUM(qty - returned_to_store_qty), 0)::int AS net
      FROM public.party_material_issues
     WHERE job_card_id = ${po.jobCardId}::uuid AND company_id = ${companyId}::uuid
       AND deleted_at IS NULL`)) as unknown as Array<{ net: number }>;
  const issuedNet = Number(issued[0]?.net ?? 0);
  const after = before - qty;
  if (after < issuedNet) {
    throw new ValidationError(
      `${jcLabel}: ${issuedNet} piece(s) of customer material are issued to it — the order cannot drop to ${after}. Return the spare pieces to store first.`,
    );
  }

  await shiftPlanPending(
    tx,
    { planId: po.planId, companyId, poCode: po.code, how: reason, user },
    async () => {
      // §20.2 — conditional on the qty and status read under the lock.
      const done = (await tx.execute(sql`
        UPDATE public.production_orders
           SET order_qty = order_qty - ${qty}, updated_at = now(), updated_by = ${user.id}::uuid
         WHERE id = ${po.id}::uuid AND order_qty = ${before} AND status = ${po.status}
        RETURNING id`)) as unknown as unknown[];
      if (done.length === 0) {
        throw new ConflictError(`${po.code} was changed by someone else — reload and try again.`);
      }
    },
  );
  await tx.execute(sql`
    UPDATE public.job_cards
       SET order_qty = GREATEST(order_qty - ${qty}, 0), updated_at = now(), updated_by = ${user.id}::uuid
     WHERE id = ${po.jobCardId}::uuid`);

  const change = { field: 'orderQty', label: 'Order Qty', before, after };
  await emitActivityLog(
    tx,
    {
      action: ActivityAction.Edit,
      entity: 'ProductionOrder',
      entityId: po.id,
      refId: po.code,
      qty,
      reason,
      changes: [change],
      detail: `${po.code} Order Qty ${before} → ${after} — ${qty} not-started piece(s) moved (${reason})`,
    },
    companyId,
    user,
  );
  await emitActivityLog(
    tx,
    {
      action: ActivityAction.Edit,
      entity: 'JobCard',
      entityId: po.jobCardId,
      refId: jcLabel,
      qty,
      reason,
      changes: [{ ...change, label: 'JC Qty' }],
      detail: `${jcLabel} JC Qty ${before} → ${after} — ${qty} not-started piece(s) moved (${reason})`,
    },
    companyId,
    user,
  );
  return { poCode: po.code, jcCode: po.jcCode, orderQtyBefore: before, orderQtyAfter: after };
}

/** ADR-291 — every piece of an order moves to the new Rev. Allowed only when
 *  the order is untouched: open, nothing received into stock, its first
 *  operation not running and every piece still not started, no customer
 *  material on the card. Read under the order's lock, then the plan's, then the
 *  first op's (the same order as reduceProductionOrderQty). The caller then stops the
 *  order through shortCloseProductionOrderTx (the one short-close writer) in
 *  the same transaction. Returns the order's code. */
export async function assertWholeOrderUntouched(
  tx: DbTransaction,
  companyId: string,
  productionOrderId: string,
  qty: number,
): Promise<string> {
  const [po] = (await tx.execute(sql`
    SELECT po.code, po.status, po.order_qty AS "orderQty", COALESCE(po.credited_qty, 0) AS credited,
           po.job_card_id AS "jobCardId", jc.code AS "jcCode", po.plan_id AS "planId"
      FROM public.production_orders po
      LEFT JOIN public.job_cards jc ON jc.id = po.job_card_id
     WHERE po.id = ${productionOrderId}::uuid AND po.company_id = ${companyId}::uuid
       AND po.deleted_at IS NULL
     LIMIT 1
       FOR UPDATE OF po`)) as unknown as Array<{
    code: string;
    status: string;
    orderQty: number;
    credited: number;
    planId: string;
    jobCardId: string;
    jcCode: string | null;
  }>;
  if (!po) throw new NotFoundError('Production Order not found. Refresh the page.');
  await assertNoPendingCancel(tx, 'production_order', productionOrderId);
  const jcLabel = po.jcCode ?? 'the Job Card';
  if (po.status !== 'open') {
    throw new ConflictError(
      `${po.code} is ${po.status.replace('_', ' ')} — its qty cannot be moved.`,
    );
  }
  if (qty !== Number(po.orderQty)) {
    throw new ConflictError(
      `${po.code} now has ${po.orderQty} on order, not ${qty}. Reload the ECR.`,
    );
  }
  if (Number(po.credited) > 0) {
    throw new ConflictError(
      `${po.code}: ${po.credited} already received into stock — it cannot move whole.`,
    );
  }
  await lockPlanRow(tx, companyId, po.planId);
  await lockFirstOp(tx, po.jobCardId);
  const ns = await readNotStartedQty(tx, po.jobCardId);
  if (ns.running) {
    throw new ConflictError(
      `${jcLabel}: the first operation is running now — stop it before moving pieces to the new Rev.`,
    );
  }
  if (ns.notStarted < qty) {
    throw new ConflictError(
      `${jcLabel}: only ${ns.notStarted} piece(s) not started — cannot move ${qty}. Reload the ECR.`,
    );
  }
  const issued = (await tx.execute(sql`
    SELECT COALESCE(SUM(qty - returned_to_store_qty), 0)::int AS net
      FROM public.party_material_issues
     WHERE job_card_id = ${po.jobCardId}::uuid AND company_id = ${companyId}::uuid
       AND deleted_at IS NULL`)) as unknown as Array<{ net: number }>;
  const issuedNet = Number(issued[0]?.net ?? 0);
  if (issuedNet > 0) {
    throw new ValidationError(
      `${jcLabel}: ${issuedNet} piece(s) of customer material are issued to it — return them to store first.`,
    );
  }
  return po.code;
}
