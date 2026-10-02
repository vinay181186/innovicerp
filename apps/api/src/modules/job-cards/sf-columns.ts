// Sort & Filter (ADR-200) — the Job Card list's sortable / filterable fields.
// Each expression is the SAME one listJobCards SELECTs for that column (same
// table aliases, used by both its list and its count query), so what the user
// filters is what the row shows. Derived figures (Progress, Pending, Ops,
// Running, Days Left) are not here: they are worked out per row after the
// query and cannot be filtered on the server.

import { sql } from 'drizzle-orm';

import type { SfColumnMap } from '../../lib/list-query';

export const JC_SF_COLUMNS: SfColumnMap = {
  jcCode: { sql: sql`jc.code`, type: 'text' },
  clientPoLineNo: { sql: sql`sol.client_po_line_no`, type: 'text' },
  // CODE/REV as the cell prints it (itemCodeWithRev): the customer's drawing
  // revision off the SO / JWSO line, after a slash.
  itemCode: {
    sql: sql`(i.code || COALESCE('/' || NULLIF(btrim(COALESCE(sol.revision::text, jwl.revision::text)), ''), ''))`,
    type: 'text',
  },
  itemName: { sql: sql`i.name`, type: 'text' },
  // SO / JWSO No. as printed: the line number after a slash unless it is line 1.
  sourceCode: {
    sql: sql`(COALESCE(so.code, jw.code) || CASE WHEN COALESCE(sol.line_no, jwl.line_no) <> 1 THEN '/' || COALESCE(sol.line_no, jwl.line_no)::text ELSE '' END)`,
    type: 'text',
  },
  orderQty: { sql: sql`jc.order_qty`, type: 'num' },
  status: { sql: sql`COALESCE(s.computed_status, 'no_ops')`, type: 'list' },
  jcDate: { sql: sql`jc.jc_date`, type: 'date' },
  dueDate: { sql: sql`COALESCE(jc.due_date, sol.due_date, jwl.due_date)`, type: 'date' },
  customerDispatchDate: {
    sql: sql`(
      SELECT p.customer_dispatch_date
      FROM public.plans p
      WHERE (
          p.jc_id = jc.id OR p.id = po.plan_id
          OR p.jc_id = pjc.id OR p.id = pjc_po.plan_id
        )
        AND p.deleted_at IS NULL AND p.plan_status <> 'cancelled'
      ORDER BY (p.jc_id = jc.id OR p.id = po.plan_id) DESC, p.created_at DESC LIMIT 1
    )`,
    type: 'date',
  },
  priority: { sql: sql`jc.priority`, type: 'list' },
  productionOrderCode: { sql: sql`po.code`, type: 'text' },
  remarks: { sql: sql`jc.remarks`, type: 'text' },
  createdOn: { sql: sql`(jc.created_at AT TIME ZONE 'Asia/Kolkata')::date`, type: 'date' },
};
