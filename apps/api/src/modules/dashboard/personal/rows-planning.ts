// ADR-250 — Planning / Design inner queries for the per-person home
// (list-query.ts shape).
//   so_to_plan  — one row per open SO / JWSO with qty still To Plan. SO lines
//                 use the shared coverage rule (lib/so-line-coverage.ts,
//                 ADR-185/221); JWSO lines the so-planning JW rule (own plans
//                 + direct order-less cards for the line's item). A line closed
//                 short or cancelled wants nothing more. x1 = Internal SO No.
//   plan_to_pro — route-card plan ready for a Production Order: plan_status
//                 'planned', no direct JC, derived status gen_production_order
//                 (lib/plan-order-coverage.ts). x1/x2/x3 = its SO / JWSO.
//   bom_pending — equipment SO still waiting for a BOM (the old work-list rule).

import { type SQL, sql } from 'drizzle-orm';
import { PLAN_PENDING_QTY_SQL, planDerivedStatusSql } from '../../../lib/plan-order-coverage';
import {
  jwLineDirectJcRaw,
  jwLinePlannedRaw,
  soLineDirectJcRaw,
  soLinePlannedRaw,
} from '../../../lib/so-line-coverage';
import { filterFrag, type ListFilter } from './list-query';

/** Shared tail of an order row built from per-line `ln` (to_plan, due_date…). */
function orderRow(today: string): SQL {
  return sql`
           MIN(ln.due_date) FILTER (WHERE ln.to_plan > 0)::text AS due_date,
           (ARRAY_AGG(ln.item_code ORDER BY ln.line_no) FILTER (WHERE ln.to_plan > 0))[1]::text AS item_code,
           (ARRAY_AGG(ln.item_name ORDER BY ln.line_no) FILTER (WHERE ln.to_plan > 0))[1]::text AS item_name,
           COALESCE(SUM(ln.to_plan), 0)::numeric AS qty,
           (ARRAY_AGG(ln.uom ORDER BY ln.line_no) FILTER (WHERE ln.to_plan > 0))[1]::text AS uom,
           NULL::numeric AS amount,
           (CASE WHEN MIN(ln.due_date) FILTER (WHERE ln.to_plan > 0) < ${today}::date
                 THEN 1 ELSE 0 END)::int AS is_late,`;
}

export function soToPlanSql(cid: string, today: string, f: ListFilter): SQL {
  return sql`
    SELECT so.id::text AS row_key, so.id, so.code, 'so'::text AS kind,
           so.so_date::text AS doc_date, so.so_date::text AS sort_key,
           COALESCE(cl.name, so.customer_name)::text AS party,
           ${orderRow(today)}
           so.created_by::text AS created_by,
           NULLIF(btrim(so.internal_so_no), '')::text AS x1, NULL::text AS x2, NULL::text AS x3
    FROM public.sales_orders so
    JOIN LATERAL (
      SELECT sol.line_no, sol.due_date, sol.item_code_text AS item_code,
             sol.part_name AS item_name, sol.uom,
             GREATEST(sol.order_qty - LEAST((cov.planned + cov.direct)::numeric, sol.order_qty), 0) AS to_plan
      FROM public.sales_order_lines sol
      CROSS JOIN LATERAL (SELECT ${sql.raw(soLinePlannedRaw('sol'))} AS planned,
                                 ${sql.raw(soLineDirectJcRaw('sol'))} AS direct) cov
      WHERE sol.sales_order_id = so.id AND sol.deleted_at IS NULL
        AND sol.status <> 'cancelled' AND sol.short_closed_at IS NULL
    ) ln ON true
    LEFT JOIN public.clients cl ON cl.id = so.client_id AND cl.deleted_at IS NULL
    WHERE so.company_id = ${cid}::uuid AND so.deleted_at IS NULL AND so.status = 'open'
      ${filterFrag(f, 'so.id', 'so.created_by')}
    GROUP BY so.id, cl.name
    HAVING COALESCE(SUM(ln.to_plan), 0) > 0
    UNION ALL
    SELECT jw.id::text AS row_key, jw.id, jw.code, 'jw'::text AS kind,
           jw.jw_date::text AS doc_date, jw.jw_date::text AS sort_key,
           COALESCE(cl.name, jw.customer_name)::text AS party,
           ${orderRow(today)}
           jw.created_by::text AS created_by,
           NULL::text AS x1, NULL::text AS x2, NULL::text AS x3
    FROM public.job_work_orders jw
    JOIN LATERAL (
      SELECT jwl.line_no, jwl.due_date, jwl.item_code_text AS item_code,
             jwl.part_name AS item_name, jwl.uom,
             GREATEST(jwl.order_qty - LEAST((cov.planned + cov.direct)::numeric, jwl.order_qty), 0) AS to_plan
      FROM public.job_work_order_lines jwl
      CROSS JOIN LATERAL (SELECT ${sql.raw(jwLinePlannedRaw('jwl'))} AS planned,
                                 ${sql.raw(jwLineDirectJcRaw('jwl'))} AS direct) cov
      WHERE jwl.job_work_order_id = jw.id AND jwl.deleted_at IS NULL
        AND jwl.status <> 'cancelled' AND jwl.short_closed_at IS NULL
    ) ln ON true
    LEFT JOIN public.clients cl ON cl.id = jw.client_id AND cl.deleted_at IS NULL
    WHERE jw.company_id = ${cid}::uuid AND jw.deleted_at IS NULL AND jw.status = 'open'
      ${filterFrag(f, 'jw.id', 'jw.created_by')}
    GROUP BY jw.id, cl.name
    HAVING COALESCE(SUM(ln.to_plan), 0) > 0`;
}

// ADR-253 — planDerivedStatusSql reads the item's Route Card through the ONE
// shared fragment (lib/plan-order-coverage.ts): only a plan whose card is
// APPROVED reads 'gen_production_order' and lands on this list.

export function planToProSql(cid: string, today: string, f: ListFilter): SQL {
  return sql`
    SELECT plans.id::text AS row_key, plans.id, plans.code, 'plan'::text AS kind,
           plans.plan_date::text AS doc_date, plans.planned_start_date::text AS due_date,
           plans.plan_date::text AS sort_key,
           COALESCE(so.customer_name, jw.customer_name)::text AS party,
           COALESCE(i.code, plans.item_code_text)::text AS item_code,
           COALESCE(plans.item_name_text, i.name)::text AS item_name,
           ${PLAN_PENDING_QTY_SQL}::numeric AS qty, i.uom::text AS uom, NULL::numeric AS amount,
           plans.created_by::text AS created_by,
           (CASE WHEN plans.planned_start_date < ${today}::date THEN 1 ELSE 0 END)::int AS is_late,
           COALESCE(so.id, jw.id)::text AS x1, COALESCE(so.code, jw.code)::text AS x2,
           (CASE WHEN so.id IS NOT NULL THEN 'so' WHEN jw.id IS NOT NULL THEN 'jw' END)::text AS x3
    FROM public.plans
    LEFT JOIN public.items i ON i.id = plans.item_id
    LEFT JOIN public.sales_order_lines sol ON sol.id = plans.so_line_id
    LEFT JOIN public.sales_orders so ON so.id = sol.sales_order_id AND so.deleted_at IS NULL
    LEFT JOIN public.job_work_order_lines jwl ON jwl.id = plans.jw_line_id
    LEFT JOIN public.job_work_orders jw ON jw.id = jwl.job_work_order_id AND jw.deleted_at IS NULL
    WHERE plans.company_id = ${cid}::uuid AND plans.deleted_at IS NULL
      AND plans.ops_source = 'route_card' AND plans.plan_status = 'planned' AND plans.jc_id IS NULL
      AND ${planDerivedStatusSql()} = 'gen_production_order'
      ${filterFrag(f, 'plans.id', 'plans.created_by')}`;
}

export function bomPendingSql(cid: string, today: string, f: ListFilter): SQL {
  return sql`
    SELECT so.id::text AS row_key, so.id, so.code, 'so'::text AS kind,
           so.so_date::text AS doc_date, MIN(sol.due_date)::text AS due_date,
           so.so_date::text AS sort_key,
           COALESCE(cl.name, so.customer_name)::text AS party,
           (ARRAY_AGG(sol.item_code_text ORDER BY sol.line_no))[1]::text AS item_code,
           (ARRAY_AGG(sol.part_name ORDER BY sol.line_no))[1]::text AS item_name,
           COALESCE(SUM(sol.order_qty), 0)::numeric AS qty,
           (ARRAY_AGG(sol.uom ORDER BY sol.line_no))[1]::text AS uom,
           NULL::numeric AS amount, so.created_by::text AS created_by,
           (CASE WHEN MIN(sol.due_date) < ${today}::date THEN 1 ELSE 0 END)::int AS is_late,
           NULLIF(btrim(so.internal_so_no), '')::text AS x1, NULL::text AS x2, NULL::text AS x3
    FROM public.sales_orders so
    LEFT JOIN public.sales_order_lines sol
      ON sol.sales_order_id = so.id AND sol.deleted_at IS NULL AND sol.status <> 'cancelled'
    LEFT JOIN public.clients cl ON cl.id = so.client_id AND cl.deleted_at IS NULL
    WHERE so.company_id = ${cid}::uuid AND so.deleted_at IS NULL AND so.type = 'equipment'
      AND so.status NOT IN ('closed', 'cancelled')
      AND (so.bom_master_id IS NULL OR so.bom_status = 'BOM Pending')
      ${filterFrag(f, 'so.id', 'so.created_by')}
    GROUP BY so.id, cl.name`;
}
