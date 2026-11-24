// ADR-264 — Production checks.
//   prod_plans_available — personal/rows-planning.ts planToProSql as is (the
//                          plan_to_pro rule: route-card plan, approved card,
//                          Pending > 0, no open Production Order).
//   prod_plans_overdue   — the same rows, Plan Start Date before today.
//   prod_due_week        — Production Orders open / partially closed whose
//                          PRO Target Date is on or before Sunday of this
//                          week (IST) — overdue ones included, red, "N days
//                          late". Qty = what is still to come (Order Qty −
//                          credited); a PRO with nothing left to come is left
//                          out, late or not.
//   prod_jc_late         — rows-production jcRunningSql, late rows only.
//   prod_ops_ready       — rows-production opsReadySql as is.
//   prod_ops_overtime    — rows-production opsRunningSql, late rows only.
//   prod_osp_send / prod_osp_at_vendor — checks/osp.ts.
//   prod_rc_pending      — (shown on PLANNING, phase 2) plans whose derived
//                          status (lib/plan-order-coverage
//                          planDerivedStatusSql) reads "no Route Card" or
//                          "Route Card waiting approval". Cancelled plans read
//                          NULL there, so they never show.
// Plan rows carry x1/x2/x3 = SO-or-JWSO id / number / 'so'|'jw' (planToProSql's
// shape), so one reference helper serves all three plan checks.

import { docNavPage } from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
import { PLAN_PENDING_QTY_SQL, planDerivedStatusSql } from '../../../lib/plan-order-coverage';
import { createdKey } from '../../../lib/list-order';
import { routeCardForItemRevSql } from '../../../lib/route-card-for-rev';
import type { RawRow } from '../personal/list-query';
import { planToProSql } from '../personal/rows-planning';
import { jcRunningSql, opsReadySql, opsRunningSql } from '../personal/rows-production';
import { enc, nextStep } from './next-step';
import { OSP_CHECKS } from './osp';
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
           ${createdKey('plans.created_at')} AS sort_key,
           COALESCE(so.customer_name, jw.customer_name)::text AS party,
           COALESCE(i.code, plans.item_code_text)::text AS item_code,
           COALESCE(plans.item_name_text, i.name)::text AS item_name,
           ${PLAN_PENDING_QTY_SQL}::numeric AS qty, i.uom::text AS uom, NULL::numeric AS amount,
           plans.created_by::text AS created_by,
           (CASE WHEN plans.planned_start_date < ${c.today}::date THEN 1 ELSE 0 END)::int AS is_late,
           COALESCE(so.id, jw.id)::text AS x1, COALESCE(so.code, jw.code)::text AS x2,
           (CASE WHEN so.id IS NOT NULL THEN 'so' WHEN jw.id IS NOT NULL THEN 'jw' END)::text AS x3,
           -- ADR-312 next step: no card → the plan's item (New Route Card);
           -- card waiting → that card (Approve). The card is the plan's own
           -- Item + Rev one (routeCardForItemRevSql, the rule ds.st reads).
           (CASE WHEN ds.st = ${RC_WAITING} THEN (
              SELECT rcw.id FROM public.route_cards rcw
              WHERE rcw.company_id = plans.company_id
                AND ${routeCardForItemRevSql('rcw', sql`plans.item_id`, sql`plans.item_revision_id`)}
              ORDER BY rcw.id LIMIT 1)
            ELSE plans.item_id END)::text AS x4
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
           pro.target_date::text AS due_date, ${createdKey('pro.created_at')} AS sort_key,
           COALESCE(so.customer_name, jw.customer_name)::text AS party,
           COALESCE(i.code, pro.item_code_text)::text AS item_code,
           COALESCE(pro.item_name_text, i.name)::text AS item_name,
           GREATEST(pro.order_qty - COALESCE(pro.credited_qty, 0), 0)::numeric AS qty,
           i.uom::text AS uom, NULL::numeric AS amount, pro.created_by::text AS created_by,
           (CASE WHEN pro.target_date < ${c.today}::date THEN 1 ELSE 0 END)::int AS is_late,
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
      AND pro.target_date <= ${weekEnd(c.today)}::date
      AND pro.order_qty - COALESCE(pro.credited_qty, 0) > 0`;
}

/** ADR-312: an available plan opens New Production Order for it. */
const newProFromPlan = nextStep(
  'prodorder_create',
  'entry',
  (r) => `/production-orders/new?planId=${r.id}&planCode=${enc(r.code)}`,
);

const planBase = {
  dept: 'production' as const,
  head: ['Plan No.', 'SO No.', 'Plan Start Date'] as CheckDef['head'],
  href: '/plans',
  docHref: (r: RawRow) => docNavPage('plan', r.id),
  refCode: (r: RawRow) => r.x2,
  refHref: planOrderHref,
  dated: true,
};

/** ADR-264 phase 2: shown on the PLANNING page (same key, same SQL) — the
 *  planner is the one who makes / approves the Route Card. Listed by
 *  planning.ts after plan_rc_approval. */
export const PLAN_RC_PENDING_CHECK: CheckDef = {
  ...planBase,
  dept: 'planning',
  key: 'prod_rc_pending',
  label: 'Plan available, RC pending',
  query: planRcPendingSql,
  statusText: (r) =>
    r.kind === RC_WAITING ? 'RC Not Approved' : r.kind === RC_MISSING ? 'No Route Card' : null,
  actionHref: (r, a) => (r.kind === RC_WAITING ? rcApprove(r, a) : rcNew(r, a)),
};

/** ADR-312: no Route Card → New Route Card for the plan's item (x4 = item
 *  id); a card waiting approval → that card, to Approve (x4 = card id). */
const rcNew = nextStep('routecard_create', 'entry', (r) =>
  r.kind === RC_MISSING && r.x4
    ? `/route-cards/new?itemId=${r.x4}&itemCode=${enc(r.itemCode ?? '')}&itemName=${enc(r.itemName ?? '')}`
    : null,
);
const rcApprove = nextStep('routecard_create', 'approve', (r) =>
  r.kind === RC_WAITING && r.x4 ? `/route-cards/${r.x4}` : null,
);

const jcHref = (r: RawRow): string => docNavPage('job-card', r.id);

/** "Running 2h 10m" — x1 = minutes on the machine (opsRunningSql). */
function runningText(r: RawRow): string {
  const m = Math.max(0, Math.round(Number(r.x1 ?? 0)));
  const h = Math.floor(m / 60);
  return h > 0 ? `Running ${h}h ${m % 60}m` : `Running ${m}m`;
}

export const PRODUCTION_CHECKS: readonly CheckDef[] = [
  {
    ...planBase,
    key: 'prod_plans_available',
    label: 'Plans available for production',
    query: (c) => planToProSql(c.cid, c.today, {}),
    actionHref: newProFromPlan,
  },
  {
    ...planBase,
    key: 'prod_plans_overdue',
    label: 'Overdue plans pending for production',
    query: (c) => narrow(planToProSql(c.cid, c.today, {}), sql`x.due_date < ${c.today}`),
    actionHref: newProFromPlan,
  },
  {
    key: 'prod_due_week',
    dept: 'production',
    label: 'Production due this week',
    head: ['PRO No.', 'Plan No.', 'PRO Target Date'],
    href: '/production-orders',
    query: proDueWeekSql,
    docHref: (r) => docNavPage('production-order', r.id),
    // ADR-312: Close Production Order, its plan picked (needs the plan).
    actionHref: nextStep('prodorder_create', 'advance', (r) =>
      r.x1 ? `/production-orders/close?planId=${r.x1}&planCode=${enc(r.x2 ?? '')}` : null,
    ),
    refCode: (r) => r.x2,
    refHref: (r) => (r.x1 ? docNavPage('plan', r.x1) : null),
    dated: true,
  },
  {
    key: 'prod_jc_late',
    dept: 'production',
    label: 'Job cards running late',
    head: ['JC No.', 'SO No.', 'Due Date'],
    href: '/job-cards',
    // jc_running rule (open card, an op not complete), late rows only.
    query: (c) => narrow(jcRunningSql(c.cid, c.today, {}), sql`x.is_late = 1`),
    docHref: jcHref,
    refCode: (r) => r.x3,
    dated: true,
  },
  {
    key: 'prod_ops_ready',
    dept: 'production',
    label: 'Operations ready to start',
    head: ['JC No.', 'Operation', 'Due Date'],
    href: '/op-entry',
    // ops_ready rule (ready-ops.ts READY_FROM); party = machine.
    query: (c) => opsReadySql(c.cid, c.today, {}),
    docHref: jcHref,
    // ADR-312: Start Operation (personal/lists.ts ops_ready); x1 = op id.
    actionHref: nextStep('op_entry', 'entry', (r) =>
      r.x1 ? `/op-entry?jc=${enc(r.code)}&op=${r.x1}&mode=start` : null,
    ),
    refCode: (r) => r.x3,
    dated: true,
  },
  {
    key: 'prod_ops_overtime',
    dept: 'production',
    label: 'Operations running over time',
    head: ['JC No.', 'Machine', 'Started'],
    href: '/op-entry/running',
    // ops_running rule, only runs past their expected time (is_late).
    query: (c) => narrow(opsRunningSql(c.cid, {}), sql`x.is_late = 1`),
    docHref: jcHref,
    // ADR-312: Complete Operation on the running op (x4 = op id).
    actionHref: nextStep('op_entry', 'entry', (r) =>
      r.x4 ? `/op-entry?jc=${enc(r.code)}&op=${r.x4}&mode=complete` : null,
    ),
    dated: false,
    statusText: runningText,
  },
  ...OSP_CHECKS,
];
