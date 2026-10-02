// Sort & Filter (ADR-200) — the JWSO Master list's sortable / filterable
// fields. Each expression is the SAME one listJobWorkOrders SELECTs for that
// column (aliases jw / agg / jca, joined in BOTH its list and its count query),
// so what the user filters is what the row shows. Customer Material (a badge
// worked out from two figures) is not here.

import { sql } from 'drizzle-orm';

import type { SfColumnMap } from '../../lib/list-query';

export const JWSO_SF_COLUMNS: SfColumnMap = {
  code: { sql: sql`jw.code`, type: 'text' },
  jwDate: { sql: sql`jw.jw_date`, type: 'date' },
  customerName: { sql: sql`jw.customer_name`, type: 'text' },
  clientPoNo: { sql: sql`jw.client_po_no`, type: 'text' },
  totalQty: { sql: sql`COALESCE(agg.total_qty, 0)::int`, type: 'num' },
  jcQty: { sql: sql`COALESCE(jca.jc_qty, 0)::int`, type: 'num' },
  dispatchedQty: { sql: sql`COALESCE(agg.dispatched_qty, 0)::int`, type: 'num' },
  // Pending as the cell prints it: never below zero.
  pendingQty: {
    sql: sql`GREATEST(0, COALESCE(agg.total_qty, 0)::int - COALESCE(agg.dispatched_qty, 0)::int)`,
    type: 'num',
  },
  earliestDueDate: { sql: sql`agg.earliest_due`, type: 'date' },
  status: { sql: sql`jw.status`, type: 'list' },
};
