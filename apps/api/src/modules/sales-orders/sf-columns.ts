// Sort & Filter (ADR-200) — the SO Master list's sortable / filterable fields.
// Each expression is the value listSalesOrders SELECTs for that column. The
// header fields read `so` directly; Order Qty, Dispatched, JC Qty and Due Date
// are per-order aggregates that the page query takes from its line_agg /
// jc_agg derived tables — the count query has neither, so here they are the
// SAME aggregates written as correlated subqueries on `so` (same tables, same
// filters), valid in both the list and the count WHERE.
//
// Not here: Pending (worked out per row: ordered − dispatched − short-closed)
// and Fulfilment (derived per row by deriveSoFulfilmentStatus) — neither is a
// stored value, so neither can be filtered on the server.

import { sql } from 'drizzle-orm';

import { jcEffectiveQtySql } from '../../lib/jc-effective-qty';
import type { SfColumnMap } from '../../lib/list-query';

/** One SO's live lines — the rows line_agg groups (same filters). */
const soLines = sql`FROM public.sales_order_lines l
  WHERE l.sales_order_id = so.id
    AND l.deleted_at IS NULL
    AND l.company_id = so.company_id`;

export const SO_SF_COLUMNS: SfColumnMap = {
  soCode: { sql: sql`so.code`, type: 'text' },
  // ADR-207 — the user-typed Internal SO No. (NULL on pre-0197 orders).
  internalSoNo: { sql: sql`so.internal_so_no`, type: 'text' },
  soDate: { sql: sql`so.so_date`, type: 'date' },
  type: { sql: sql`so.type`, type: 'list' },
  customerName: { sql: sql`so.customer_name`, type: 'text' },
  clientPoNo: { sql: sql`so.client_po_no`, type: 'text' },
  totalQty: { sql: sql`COALESCE((SELECT SUM(l.order_qty) ${soLines}), 0)::int`, type: 'num' },
  dispatchedQty: {
    sql: sql`COALESCE((SELECT SUM(l.dispatched_qty) ${soLines}), 0)::int`,
    type: 'num',
  },
  // jc_agg's sum: every live, non-recovery card raised against a line of this SO.
  jcQty: {
    sql: sql`COALESCE((
      SELECT SUM(${jcEffectiveQtySql('jc')})
      FROM public.job_cards jc
      JOIN public.sales_order_lines sol ON jc.source_so_line_id = sol.id
      WHERE sol.sales_order_id = so.id
        AND jc.deleted_at IS NULL
        AND jc.recovery_kind IS NULL
    ), 0)::int`,
    type: 'num',
  },
  // The list's "Due Date" is the earliest line due date (line_agg MIN).
  earliestDueDate: { sql: sql`(SELECT MIN(l.due_date) ${soLines})`, type: 'date' },
  status: { sql: sql`so.status`, type: 'list' },
  createdOn: { sql: sql`(so.created_at AT TIME ZONE 'Asia/Kolkata')::date`, type: 'date' },
};

// ADR-261 — GET /sales-orders/lines (one row per SO LINE; aliases l = the
// line, so = its order, it = the live item). Header fields as above; the qty
// and date fields keep the SO list's names (a sort saved on the SO Master
// stays valid) but are the LINE's own values, as the row shows them.
export const SO_LINE_SF_COLUMNS: SfColumnMap = {
  soCode: SO_SF_COLUMNS.soCode!,
  internalSoNo: SO_SF_COLUMNS.internalSoNo!,
  soDate: SO_SF_COLUMNS.soDate!,
  type: SO_SF_COLUMNS.type!,
  customerName: SO_SF_COLUMNS.customerName!,
  clientPoNo: SO_SF_COLUMNS.clientPoNo!,
  status: SO_SF_COLUMNS.status!,
  clientPoLineNo: { sql: sql`l.client_po_line_no`, type: 'text' },
  createdOn: {
    sql: sql`(COALESCE(l.created_at, so.created_at) AT TIME ZONE 'Asia/Kolkata')::date`,
    type: 'date',
  },
  itemCode: { sql: sql`COALESCE(it.code, l.item_code_text)`, type: 'text' },
  itemName: { sql: sql`l.part_name`, type: 'text' },
  totalQty: { sql: sql`l.order_qty`, type: 'num' },
  dispatchedQty: { sql: sql`l.dispatched_qty`, type: 'num' },
  jcQty: {
    sql: sql`COALESCE((
      SELECT SUM(${jcEffectiveQtySql('sjc')})
      FROM public.job_cards sjc
      WHERE sjc.source_so_line_id = l.id
        AND sjc.deleted_at IS NULL
        AND sjc.recovery_kind IS NULL
    ), 0)::int`,
    type: 'num',
  },
  earliestDueDate: { sql: sql`l.due_date`, type: 'date' },
};
