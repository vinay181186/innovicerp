// ADR-264 — Production checks.
//   prod_plans_available — personal/rows-planning.ts planToProSql as is (the
//                          plan_to_pro rule: route-card plan, approved card,
//                          Pending > 0, no open Production Order).
//   prod_plans_overdue   — the same rows, Plan Start Date before today.
//   prod_due_week        — Production Orders open / partially closed whose
//                          PRO Target Date falls today .. Sunday (IST). Qty =
//                          what is still to come (Order Qty − credited).
//   prod_rc_pending      — plans whose derived status (lib/plan-order-coverage
//                          planDerivedStatusSql) reads "no Route Card" or
//                          "Route Card waiting approval". Cancelled plans read
//                          NULL there, so they never show.
// Plan rows carry x1/x2/x3 = SO-or-JWSO id / number / 'so'|'jw' (planToProSql's
// shape), so one reference helper serves all three plan checks.

import { docNavPage } from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
import { PLAN_PENDING_QTY_SQL, planDerivedStatusSql } from '../../../lib/plan-order-coverage';
import type { RawRow } from '../personal/list-query';
import { planToProSql } from '../personal/rows-planning';
import { type CheckCtx, type CheckDef, narrow, weekEnd } from './types';

const planOrderHref = (r: RawRow): string | null =>
  r.x1 ? docNavPage(r.x3 === 'jw' ? 'job-work-order' : 'sales-order', r.x1) : null;

/** The plan's SO / JWSO joins, as planToProSql writes them. */
const PLAN_ORDER_JOINS = sql`
    LEFT JOIN public.items i ON i.id = plans.item_id
    LEFT JOIN public.sales_order_lines sol ON sol.id = plans.so_line_id
    LEFT JOIN public.sales_orders so ON so.id = sol.sales_order_id AND so.deleted_at IS NULL
    LEFT JOIN public.job_work_order_lines jwl ON jwl.id = plans.jw_line_id
    LEFT JOIN public.job_work_orders jw ON jw.id = jwl.job_work_order_id AND jw.deleted_at IS NULL`;

const RC_MISSING = 'route_card_pending';
const RC_WAITING = 'route_card_approval_pending';

export function planRcPendingSql(c: CheckCtx): SQL {
  return sql`
    SELECT plans.id::text AS row_key, plans.id, plans.code, ds.st::text AS kind,
           plans.plan_date::text AS doc_date, plans.planned_start_date::text AS due_date,
           COALESCE(plans.planned_start_date, plans.plan_date)::text AS sort_key,
           COALESCE(so.customer_name, jw.customer_name)::text AS party,
           COALESCE(i.code, plans.item_code_text)::text AS item_code,
           COALESCE(plans.item_name_text, i.name)::text AS item_name,
           ${PLAN_PENDING_QTY_SQL}::numeric AS qty, i.uom::text AS uom, NULL::numeric AS amount,
           plans.created_by::text AS created_by,
           (CASE WHEN plans.planned_start_date < ${c.today}::date THEN 1 ELSE 0 END)::int AS is_late,
           COALESCE(so.id, jw.id)::text AS x1, COALESCE(so.code, jw.code)::text AS x2,
           (CASE WHEN so.id IS NOT NULL THEN 'so' WHEN jw.id IS NOT NULL THEN 'jw' END)::text AS x3
    FROM public.plans
    ${PLAN_ORDER_JOINS}
    CROSS JOIN LATERAL (SELECT ${planDerivedStatusSql()} AS st) ds
    WHERE plans.company_id = ${c.cid}::uuid AND plans.deleted_at IS NULL
      AND plans.plan_status <> 'cancelled'
      AND ds.st IN (${RC_MISSING}, ${RC_WAITING})`;
}

export function proDueWeekSql(c: CheckCtx): SQL {
  return sql`
    SELECT pro.id::text AS row_key, pro.id, pro.code, 'pro'::text AS kind,
           ((pro.created_at AT TIME ZONE 'Asia/Kolkata')::date)::text AS doc_date,
           pro.target_date::text AS due_date, pro.target_date::text AS sort_key,
           COALESCE(so.customer_name, jw.customer_name)::text AS party,
           COALESCE(i.code, pro.item_code_text)::text AS item_code,
           COALESCE(pro.item_name_text, i.name)::text AS item_name,
           GREATEST(pro.order_qty - COALESCE(pro.credited_qty, 0), 0)::numeric AS qty,
           i.uom::text AS uom, NULL::numeric AS amount, pro.created_by::text AS created_by,
           0::int AS is_late,
           plans.id::text AS x1, COALESCE(plans.code, pro.plan_code_text)::text AS x2,
           NULL::text AS x3
    FROM public.production_orders pro
    LEFT JOIN public.plans ON plans.id = pro.plan_id AND plans.deleted_at IS NULL
    LEFT JOIN public.items i ON i.id = pro.item_id
    LEFT JOIN public.sales_order_lines sol ON sol.id = plans.so_line_id
    LEFT JOIN public.sales_orders so ON so.id = sol.sales_order_id AND so.deleted_at IS NULL
    LEFT JOIN public.job_work_order_lines jwl ON jwl.id = plans.jw_line_id
    LEFT JOIN public.job_work_orders jw ON jw.id = jwl.job_work_order_id AND jw.deleted_at IS NULL
    WHERE pro.company_id = ${c.cid}::uuid AND pro.deleted_at IS NULL
      AND pro.status IN ('open', 'partially_closed')
      AND pro.target_date BETWEEN ${c.today}::date AND ${weekEnd(c.today)}::date`;
}

const planBase = {
  dept: 'production' as const,
  head: ['Plan No.', 'SO No.', 'Plan Start Date'] as CheckDef['head'],
  href: '/plans',
  docHref: (r: RawRow) => docNavPage('plan', r.id),
  refCode: (r: RawRow) => r.x2,
  refHref: planOrderHref,
  dated: true,
};

export const PRODUCTION_CHECKS: readonly CheckDef[] = [
  {
    ...planBase,
    key: 'prod_plans_available',
    label: 'Plans available for production',
    query: (c) => planToProSql(c.cid, c.today, {}),
  },
  {
    ...planBase,
    key: 'prod_plans_overdue',
    label: 'Overdue plans pending for production',
    query: (c) => narrow(planToProSql(c.cid, c.today, {}), sql`x.due_date < ${c.today}`),
  },
  {
    key: 'prod_due_week',
    dept: 'production',
    label: 'Production due this week',
    head: ['PRO No.', 'Plan No.', 'PRO Target Date'],
    href: '/production-orders',
    query: proDueWeekSql,
    docHref: (r) => docNavPage('production-order', r.id),
    refCode: (r) => r.x2,
    refHref: (r) => (r.x1 ? docNavPage('plan', r.x1) : null),
    dated: true,
  },
  {
    ...planBase,
    key: 'prod_rc_pending',
    label: 'Plan available, RC pending',
    query: planRcPendingSql,
    statusText: (r) =>
      r.kind === RC_WAITING
        ? 'RC waiting approval'
        : r.kind === RC_MISSING
          ? 'No Route Card'
          : null,
  },
];
