// ADR-264 — Sales checks: SO + JWSO lines not fully delivered, by Due Date.
//   SO line pending   = order_qty − dispatched_qty (customer-dispatches keeps it)
//   JWSO line pending = order_qty − returned_qty   (job-work returns keep it)
// A line cancelled, closed short, deleted, or on a header that is not open
// wants nothing more. Lines with no Due Date are in no window.
//   sales_overdue   — due before today (IST)
//   sales_due_week  — today .. Sunday (Monday-start week), not overdue
//   sales_due_month — today .. last day of the month, not overdue
// One row per LINE (document = its SO / JWSO, reference = Client PO No.).
// No existing fragment reads per-line pending by due date (rows-planning's
// so_to_plan reads To Plan per order), so the line SQL is written here.

import { docNavPage } from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
import type { RawRow } from '../personal/list-query';
import { type CheckCtx, type CheckDef, monthEnd, weekEnd } from './types';

type Window = 'overdue' | 'week' | 'month';

function windowFrag(col: string, w: Window, today: string): SQL {
  const c = sql.raw(col);
  if (w === 'overdue') return sql`${c} < ${today}::date`;
  const end = w === 'week' ? weekEnd(today) : monthEnd(today);
  return sql`${c} BETWEEN ${today}::date AND ${end}::date`;
}

export function salesLinesSql(c: CheckCtx, w: Window): SQL {
  return sql`
    SELECT sol.id::text AS row_key, so.id, so.code, 'so'::text AS kind,
           so.so_date::text AS doc_date, sol.due_date::text AS due_date,
           sol.due_date::text AS sort_key,
           COALESCE(cl.name, so.customer_name)::text AS party,
           COALESCE(i.code, sol.item_code_text)::text AS item_code,
           sol.part_name::text AS item_name,
           (sol.order_qty - sol.dispatched_qty)::numeric AS qty, sol.uom::text AS uom,
           NULL::numeric AS amount, so.created_by::text AS created_by,
           (CASE WHEN sol.due_date < ${c.today}::date THEN 1 ELSE 0 END)::int AS is_late,
           NULLIF(btrim(so.client_po_no), '')::text AS x1, NULL::text AS x2, NULL::text AS x3
    FROM public.sales_order_lines sol
    JOIN public.sales_orders so
      ON so.id = sol.sales_order_id AND so.deleted_at IS NULL AND so.status = 'open'
    LEFT JOIN public.items i ON i.id = sol.item_id
    LEFT JOIN public.clients cl ON cl.id = so.client_id AND cl.deleted_at IS NULL
    WHERE so.company_id = ${c.cid}::uuid AND sol.deleted_at IS NULL
      AND sol.status <> 'cancelled' AND sol.short_closed_at IS NULL
      AND sol.order_qty > sol.dispatched_qty
      AND ${windowFrag('sol.due_date', w, c.today)}
    UNION ALL
    SELECT jwl.id::text AS row_key, jw.id, jw.code, 'jw'::text AS kind,
           jw.jw_date::text AS doc_date, jwl.due_date::text AS due_date,
           jwl.due_date::text AS sort_key,
           COALESCE(cl.name, jw.customer_name)::text AS party,
           COALESCE(i.code, jwl.item_code_text)::text AS item_code,
           jwl.part_name::text AS item_name,
           (jwl.order_qty - jwl.returned_qty)::numeric AS qty, jwl.uom::text AS uom,
           NULL::numeric AS amount, jw.created_by::text AS created_by,
           (CASE WHEN jwl.due_date < ${c.today}::date THEN 1 ELSE 0 END)::int AS is_late,
           NULLIF(btrim(jw.client_po_no), '')::text AS x1, NULL::text AS x2, NULL::text AS x3
    FROM public.job_work_order_lines jwl
    JOIN public.job_work_orders jw
      ON jw.id = jwl.job_work_order_id AND jw.deleted_at IS NULL AND jw.status = 'open'
    LEFT JOIN public.items i ON i.id = jwl.item_id
    LEFT JOIN public.clients cl ON cl.id = jw.client_id AND cl.deleted_at IS NULL
    WHERE jw.company_id = ${c.cid}::uuid AND jwl.deleted_at IS NULL
      AND jwl.status <> 'cancelled' AND jwl.short_closed_at IS NULL
      AND jwl.order_qty > jwl.returned_qty
      AND ${windowFrag('jwl.due_date', w, c.today)}`;
}

/** The SO or JWSO page, by the row's kind. */
export const orderHref = (r: RawRow): string =>
  r.kind === 'jw' ? docNavPage('job-work-order', r.id) : docNavPage('sales-order', r.id);

const salesDef = (key: CheckDef['key'], label: string, w: Window): CheckDef => ({
  key,
  dept: 'sales',
  label,
  head: ['SO No.', 'Client PO No.', 'Due Date'],
  href: '/sales-orders',
  query: (c) => salesLinesSql(c, w),
  docHref: orderHref,
  refCode: (r) => r.x1,
  dated: true,
});

export const SALES_CHECKS: readonly CheckDef[] = [
  salesDef('sales_overdue', 'Overdue deliveries', 'overdue'),
  salesDef('sales_due_week', 'Delivering this week', 'week'),
  salesDef('sales_due_month', 'Delivering this month', 'month'),
];
