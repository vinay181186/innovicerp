// Plan — Cancel (ADR-235 Phase C). Only via an approved Cancel Request: the
// plan's status becomes 'cancelled' (plan_status already had the value, and
// every coverage / pending-to-plan reader already skips it), stamped with
// cancel_reason / cancelled_at / cancelled_by (0220). The plan stays on the
// register; nothing else is written — its SO / JWSO line simply counts it no
// more, so the qty becomes unplanned again.
//
// Only while nothing was made from it: no Production Order (any state — a
// stopped order is still history, the same rule softDeletePlan keeps), no live
// Job Card, no Purchase Request that is not cancelled.
//
// Kept apart from service.ts on purpose (another change is in flight there);
// service.ts only calls assertNoPendingCancel on its write paths.

import { ActivityAction, type CancelBlocker, type CancelEffect } from '@innovic/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { plans } from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { labelOf, PLAN_STATUS_LABEL, PLAN_TYPE_LABEL } from '../../lib/status-labels';
import { emitActivityLog } from '../activity-log/service';
import { blockerRefusal } from '../cancel-requests/messages';

export type PlanCancelRow = typeof plans.$inferSelect;

/** Read the plan; `forUpdate` locks it (request / approve / the worker), the
 *  preview reads without a lock. Cancelled plans are returned too (the status
 *  says so). null = not found in this company. */
export async function lockPlanForCancel(
  tx: DbTransaction,
  companyId: string,
  id: string,
  forUpdate: boolean,
): Promise<PlanCancelRow | null> {
  const q = tx
    .select()
    .from(plans)
    .where(and(eq(plans.id, id), eq(plans.companyId, companyId), isNull(plans.deletedAt)))
    .limit(1);
  const rows = forUpdate ? await q.for('update') : await q;
  return rows[0] ?? null;
}

/**
 * THE Plan cancel refusal rule (one place — the worker, under the plan lock,
 * and the Cancel preview both call it). Each blocker names the document made
 * from the plan:
 *   · a Production Order on it (any status, as softDeletePlan);
 *   · its Job Card while that card is live;
 *   · a Purchase Request it raised (Direct Purchase / Full Outsource / its
 *     material PR) that is not cancelled.
 * Every write that makes those documents takes the same plan row lock first
 * (Production Order create, Execute), so the check cannot be raced.
 */
export async function planCancelBlockers(
  tx: DbTransaction,
  companyId: string,
  id: string,
): Promise<CancelBlocker[]> {
  const plan = await lockPlanForCancel(tx, companyId, id, false);
  if (!plan) return [];
  const out: CancelBlocker[] = [];

  const orders = (await tx.execute(sql`
    SELECT po.id, po.code
    FROM public.production_orders po
    WHERE po.plan_id = ${id}::uuid AND po.company_id = ${companyId}::uuid
      AND po.deleted_at IS NULL
    ORDER BY po.code
  `)) as unknown as Array<{ id: string; code: string }>;
  for (const o of orders) {
    out.push({
      docLabel: 'Production Order',
      docNo: o.code,
      href: `/production-orders/${o.id}`,
      reason: 'made from this plan — a plan with order history stays',
    });
  }

  if (plan.jcId) {
    const jc = (await tx.execute(sql`
      SELECT jc.id, jc.code
      FROM public.job_cards jc
      WHERE jc.id = ${plan.jcId}::uuid AND jc.company_id = ${companyId}::uuid
        AND jc.deleted_at IS NULL
    `)) as unknown as Array<{ id: string; code: string }>;
    for (const j of jc) {
      out.push({
        docLabel: 'Job Card',
        docNo: j.code,
        href: `/job-cards/${j.id}`,
        reason: 'built from this plan',
      });
    }
  }

  const prIds = [plan.dpPrId, plan.foPrId, plan.foMatPrId, plan.materialPrId].filter(
    (v): v is string => typeof v === 'string',
  );
  if (prIds.length > 0) {
    const prs = (await tx.execute(sql`
      SELECT pr.id, pr.code
      FROM public.purchase_requests pr
      WHERE pr.id = ANY(${sql.param(Array.from(new Set(prIds)))}::uuid[])
        AND pr.company_id = ${companyId}::uuid
        AND pr.deleted_at IS NULL AND pr.status <> 'cancelled'
      ORDER BY pr.code
    `)) as unknown as Array<{ id: string; code: string }>;
    for (const p of prs) {
      out.push({
        docLabel: 'Purchase Request',
        docNo: p.code,
        href: `/purchase-requests/${p.id}`,
        reason: 'raised from this plan and not cancelled',
      });
    }
  }
  return out;
}

/** The SO / JWSO line the plan covers, read live (snapshot as fallback). */
async function readPlanSource(
  tx: DbTransaction,
  companyId: string,
  plan: PlanCancelRow,
): Promise<{ kind: 'SO' | 'JWSO'; code: string; lineNo: number | null } | null> {
  if (plan.soLineId) {
    const rows = (await tx.execute(sql`
      SELECT so.code, sol.line_no AS "lineNo"
      FROM public.sales_order_lines sol
      JOIN public.sales_orders so ON so.id = sol.sales_order_id
      WHERE sol.id = ${plan.soLineId}::uuid AND sol.company_id = ${companyId}::uuid
    `)) as unknown as Array<{ code: string; lineNo: number }>;
    const r = rows[0];
    return {
      kind: 'SO',
      code: r?.code ?? plan.soCodeText ?? 'SO',
      lineNo: r ? Number(r.lineNo) : plan.lineNo,
    };
  }
  if (plan.jwLineId) {
    const rows = (await tx.execute(sql`
      SELECT jw.code, jwl.line_no AS "lineNo"
      FROM public.job_work_order_lines jwl
      JOIN public.job_work_orders jw ON jw.id = jwl.job_work_order_id
      WHERE jwl.id = ${plan.jwLineId}::uuid AND jwl.company_id = ${companyId}::uuid
    `)) as unknown as Array<{ code: string; lineNo: number }>;
    const r = rows[0];
    return {
      kind: 'JWSO',
      code: r?.code ?? plan.soCodeText ?? 'JWSO',
      lineNo: r ? Number(r.lineNo) : plan.lineNo,
    };
  }
  return null;
}

/** What the cancel will do — shown before the user commits. */
export async function planCancelEffects(
  tx: DbTransaction,
  companyId: string,
  id: string,
): Promise<CancelEffect[]> {
  const plan = await lockPlanForCancel(tx, companyId, id, false);
  if (!plan) return [];
  const out: CancelEffect[] = [];
  const src = await readPlanSource(tx, companyId, plan);
  const qty = Number(plan.planQty);
  if (src) {
    const ln = src.lineNo != null ? ` Ln ${src.lineNo}` : '';
    out.push({
      kind: 'reopen',
      text: `${src.code}${ln}: ${qty} becomes unplanned again`,
      qty,
    });
  }
  if (plan.soLineId) {
    out.push({
      kind: 'note',
      text: 'Stock booked for the SO line stays booked on the SO line — release it there if it is no longer needed.',
      qty: null,
    });
  }
  return out;
}

/**
 * The ONE Plan cancel writer, run only by an approved Cancel Request
 * (ADR-235). In-tx body, no rights check — the Cancel Request checks the ticks.
 */
export async function cancelPlanTx(
  tx: DbTransaction,
  companyId: string,
  id: string,
  reason: string,
  user: AuthContext,
): Promise<void> {
  const trimmed = (reason ?? '').trim();
  if (!trimmed) throw new ValidationError('Reason is required to cancel a Plan.');

  // The plan row lock first — Production Order create, Execute and every plan
  // edit take the same lock, so nothing can be made from the plan between the
  // refusal rule below and the status change.
  const plan = await lockPlanForCancel(tx, companyId, id, true);
  if (!plan) throw new NotFoundError('Plan not found. It may have been deleted.');
  if (plan.planStatus === 'cancelled') {
    throw new ConflictError(`${plan.code} is already cancelled. Refresh the page.`);
  }

  const blockers = await planCancelBlockers(tx, companyId, id);
  if (blockers.length > 0) {
    throw new ConflictError(blockerRefusal(plan.code, blockers), { blockers });
  }

  // §20.2 — one conditional UPDATE on the status read under the lock; 0 rows =
  // someone moved it first.
  const now = new Date();
  const moved = await tx
    .update(plans)
    .set({
      planStatus: 'cancelled',
      cancelReason: trimmed,
      cancelledAt: now,
      cancelledBy: user.id,
      updatedAt: now,
      updatedBy: user.id,
    })
    .where(
      and(
        eq(plans.id, id),
        eq(plans.companyId, companyId),
        isNull(plans.deletedAt),
        eq(plans.planStatus, plan.planStatus),
      ),
    )
    .returning({ id: plans.id });
  if (moved.length === 0) {
    throw new ConflictError(`${plan.code} changed a moment ago. Refresh the page.`);
  }

  const src = await readPlanSource(tx, companyId, plan);
  const srcText = src ? ` — ${src.code}${src.lineNo != null ? ` Ln ${src.lineNo}` : ''}` : '';
  await emitActivityLog(
    tx,
    {
      action: ActivityAction.Cancel,
      entity: 'Plan',
      entityId: plan.id,
      refId: plan.code,
      qty: Number(plan.planQty),
      reason: trimmed,
      changes: [
        {
          field: 'planStatus',
          label: 'Plan Status',
          before: labelOf(PLAN_STATUS_LABEL, plan.planStatus),
          after: labelOf(PLAN_STATUS_LABEL, 'cancelled'),
        },
      ],
      detail: `${plan.code} (${labelOf(PLAN_TYPE_LABEL, plan.planType)}) cancelled${srcText}: ${plan.planQty} unplanned again`,
    },
    companyId,
    user,
  );
}
