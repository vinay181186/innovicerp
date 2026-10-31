// ADR-264 — Planning checks.
//   plan_so_unplanned — one row per SO / JWSO LINE not fully planned (the
//                       label says "lines", so the count is lines, not
//                       orders). Same rule and exclusions as the ADR-250
//                       so_to_plan list (personal/rows-planning.ts
//                       soToPlanSql): SO lines read lib/so-line-coverage.ts
//                       (ADR-185/221), JWSO lines own plans + direct
//                       order-less cards for the line's item; a line
//                       cancelled, closed short or deleted, or on a header
//                       that is not open, wants nothing more. soToPlanSql
//                       groups by order, so the per-line SQL is written here
//                       with the same shared coverage fragments (SO and
//                       JWSO, lib/so-line-coverage.ts).
//                       Qty = To Plan, date = the line's Due Date,
//                       reference = Client PO No.
//   plan_rc_approval  — personal/rows-route-card.ts rcPendingSql (new Route
//                       Cards Pending Approval); its date is the card's
//                       Created On (IST day), the status reads its age.

import { type SQL, sql } from 'drizzle-orm';
import {
  jwLineDirectJcRaw,
  jwLinePlannedRaw,
  soLineDirectJcRaw,
  soLinePlannedRaw,
} from '../../../lib/so-line-coverage';
import { rcPendingSql } from '../personal/rows-route-card';
import { orderHref } from './sales';
import type { CheckCtx, CheckDef } from './types';

export function soLinesUnplannedSql(c: CheckCtx): SQL {
  return sql`
    SELECT sol.id::text AS row_key, so.id, so.code, 'so'::text AS kind,
           so.so_date::text AS doc_date, sol.due_date::text AS due_date,
           sol.due_date::text AS sort_key,
           COALESCE(cl.name, so.customer_name)::text AS party,
           COALESCE(i.code, sol.item_code_text)::text AS item_code,
           sol.part_name::text AS item_name,
           ln.to_plan::numeric AS qty, sol.uom::text AS uom,
           NULL::numeric AS amount, so.created_by::text AS created_by,
           (CASE WHEN sol.due_date < ${c.today}::date THEN 1 ELSE 0 END)::int AS is_late,
           NULLIF(btrim(so.client_po_no), '')::text AS x1, NULL::text AS x2, NULL::text AS x3
    FROM public.sales_order_lines sol
    JOIN public.sales_orders so
      ON so.id = sol.sales_order_id AND so.deleted_at IS NULL AND so.status = 'open'
    CROSS JOIN LATERAL (SELECT ${sql.raw(soLinePlannedRaw('sol'))} AS planned,
                               ${sql.raw(soLineDirectJcRaw('sol'))} AS direct) cov
    CROSS JOIN LATERAL (SELECT GREATEST(sol.order_qty
             - LEAST((cov.planned + cov.direct)::numeric, sol.order_qty), 0) AS to_plan) ln
    LEFT JOIN public.items i ON i.id = sol.item_id
    LEFT JOIN public.clients cl ON cl.id = so.client_id AND cl.deleted_at IS NULL
    WHERE so.company_id = ${c.cid}::uuid AND sol.deleted_at IS NULL
      AND sol.status <> 'cancelled' AND sol.short_closed_at IS NULL
      AND ln.to_plan > 0
    UNION ALL
    SELECT jwl.id::text AS row_key, jw.id, jw.code, 'jw'::text AS kind,
           jw.jw_date::text AS doc_date, jwl.due_date::text AS due_date,
           jwl.due_date::text AS sort_key,
           COALESCE(cl.name, jw.customer_name)::text AS party,
           COALESCE(i.code, jwl.item_code_text)::text AS item_code,
           jwl.part_name::text AS item_name,
           ln.to_plan::numeric AS qty, jwl.uom::text AS uom,
           NULL::numeric AS amount, jw.created_by::text AS created_by,
           (CASE WHEN jwl.due_date < ${c.today}::date THEN 1 ELSE 0 END)::int AS is_late,
           NULLIF(btrim(jw.client_po_no), '')::text AS x1, NULL::text AS x2, NULL::text AS x3
    FROM public.job_work_order_lines jwl
    JOIN public.job_work_orders jw
      ON jw.id = jwl.job_work_order_id AND jw.deleted_at IS NULL AND jw.status = 'open'
    CROSS JOIN LATERAL (SELECT ${sql.raw(jwLinePlannedRaw('jwl'))} AS planned,
                               ${sql.raw(jwLineDirectJcRaw('jwl'))} AS direct) cov
    CROSS JOIN LATERAL (SELECT GREATEST(jwl.order_qty
             - LEAST((cov.planned + cov.direct)::numeric, jwl.order_qty), 0) AS to_plan) ln
    LEFT JOIN public.items i ON i.id = jwl.item_id
    LEFT JOIN public.clients cl ON cl.id = jw.client_id AND cl.deleted_at IS NULL
    WHERE jw.company_id = ${c.cid}::uuid AND jwl.deleted_at IS NULL
      AND jwl.status <> 'cancelled' AND jwl.short_closed_at IS NULL
      AND ln.to_plan > 0`;
}

export const PLANNING_CHECKS: readonly CheckDef[] = [
  {
    key: 'plan_so_unplanned',
    dept: 'planning',
    label: 'SO lines not planned',
    head: ['SO No.', 'Client PO No.', 'Due Date'],
    href: '/planning',
    query: soLinesUnplannedSql,
    docHref: orderHref,
    refCode: (r) => r.x1,
    dated: true,
  },
  {
    key: 'plan_rc_approval',
    dept: 'planning',
    label: 'Route Card waiting approval',
    // A new card has no parent document: the reference column stays empty.
    head: ['RC No.', '—', 'Created On'],
    href: '/route-cards',
    query: (c) => rcPendingSql(c.cid, {}),
    docHref: (r) => `/route-cards/${r.id}`,
    dated: false,
    // rcPendingSql's qty is the card's op count, not a quantity.
    noQty: true,
  },
];
