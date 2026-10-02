// Sort & Filter (ADR-200) — the Production Orders list's sortable / filterable
// fields. Each expression is what listProductionOrders SELECTs / shows for the
// column, written on production_orders alone (snapshots + correlated scalars)
// so it is valid in the count query too, which selects from that table only.
// The item revision and the finished qty are the service's own fragments,
// passed in so the filter and the cell can never read two different things.

import { type SQL, sql } from 'drizzle-orm';

import { productionOrders } from '../../db/schema';
import type { SfColumnMap } from '../../lib/list-query';

export function productionOrderSfColumns(frags: {
  itemRevision: SQL;
  jcFinishedQty: SQL;
}): SfColumnMap {
  return {
    code: { sql: sql`${productionOrders.code}`, type: 'text' },
    createdOn: {
      sql: sql`(${productionOrders.createdAt} AT TIME ZONE 'Asia/Kolkata')::date`,
      type: 'date',
    },
    // CODE/REV as the cell prints it (itemCodeWithRev).
    itemCode: {
      sql: sql`(${productionOrders.itemCodeText} || COALESCE('/' || NULLIF(btrim(${frags.itemRevision}), ''), ''))`,
      type: 'text',
    },
    itemName: { sql: sql`${productionOrders.itemNameText}`, type: 'text' },
    orderQty: { sql: sql`${productionOrders.orderQty}`, type: 'num' },
    jcFinishedQty: { sql: frags.jcFinishedQty, type: 'num' },
    status: { sql: sql`${productionOrders.status}`, type: 'list' },
    targetDate: { sql: sql`${productionOrders.targetDate}`, type: 'date' },
    planCode: { sql: sql`${productionOrders.planCodeText}`, type: 'text' },
    // SO / JWSO No. as printed: the line number after a slash when there is one.
    sourceCode: {
      sql: sql`(${productionOrders.soCodeText} || COALESCE('/' || NULLIF(${productionOrders.lineNo}, 0)::text, ''))`,
      type: 'text',
    },
    clientPoLineNo: {
      sql: sql`(
        SELECT sol.client_po_line_no
          FROM public.plans p
          JOIN public.sales_order_lines sol ON sol.id = p.so_line_id
         WHERE p.id = ${productionOrders.planId} LIMIT 1
      )`,
      type: 'text',
    },
    jcCode: { sql: sql`${productionOrders.jcCodeText}`, type: 'text' },
  };
}
