// Sort & Filter (ADR-200) — the Plans list's sortable / filterable fields.
// Each expression is the SAME one listPlans SELECTs / shows for that column,
// over the tables its list AND count query both join (plans, items, the SO
// line, the JWSO line — all one row per plan). The status is the effective
// status the row shows (ADR-185), passed in from the service so the filter and
// the badge use one expression.

import { type SQL, sql } from 'drizzle-orm';

import { items, jobWorkOrderLines, plans, salesOrderLines } from '../../db/schema';
import { PLAN_PENDING_QTY_SQL } from '../../lib/plan-order-coverage';
import type { SfColumnMap } from '../../lib/list-query';

export function planSfColumns(effectiveStatus: SQL): SfColumnMap {
  return {
    code: { sql: sql`${plans.code}`, type: 'text' },
    planDate: { sql: sql`${plans.planDate}`, type: 'date' },
    planType: { sql: sql`${plans.planType}`, type: 'list' },
    // ADR-207 — the Internal SO No. of the plan's order, the SAME scalar
    // listPlans SELECTs (service.ts PLAN_SO_INTERNAL_NO_SQL): read live through
    // the plan's SO line, never copied onto the plan. Keyed on plans.so_line_id
    // alone, so it is valid in the count query too (which joins the same
    // one-row-per-plan tables), and a scalar, so it cannot multiply the row.
    soInternalNo: {
      sql: sql`(
        SELECT pso.internal_so_no FROM public.sales_order_lines psol
        JOIN public.sales_orders pso ON pso.id = psol.sales_order_id
        WHERE psol.id = ${plans.soLineId}
      )`,
      type: 'text',
    },
    // CODE/REV as the cell prints it: the live item code (else the text the
    // plan stored), then the SO / JWSO line's drawing revision after a slash.
    itemCode: {
      sql: sql`(COALESCE(${items.code}, ${plans.itemCodeText}) || COALESCE('/' || NULLIF(btrim(COALESCE(${salesOrderLines.revision}::text, ${jobWorkOrderLines.revision}::text)), ''), ''))`,
      type: 'text',
    },
    itemName: { sql: sql`COALESCE(${items.name}, ${plans.itemNameText})`, type: 'text' },
    planQty: { sql: sql`${plans.planQty}`, type: 'num' },
    pendingQty: { sql: PLAN_PENDING_QTY_SQL, type: 'num' },
    status: { sql: effectiveStatus, type: 'list' },
  };
}
