// Sort & Filter (ADR-200) — the JWSO Master list's sortable / filterable
// fields. Each expression is the SAME one listJobWorkOrders SELECTs for that
// column (aliases jw / agg / jca, joined in BOTH its list and its count query),
// so what the user filters is what the row shows. Customer Material (a badge
// worked out from two figures) is not here.

import { sql } from 'drizzle-orm';

import { createdByNameSql } from '../../lib/created-by-sql';
import type { SfColumnMap } from '../../lib/list-query';

export const JWSO_SF_COLUMNS: SfColumnMap = {
  code: { sql: sql`jw.code`, type: 'text' },
  jwDate: { sql: sql`jw.jw_date`, type: 'date' },
  customerName: { sql: sql`jw.customer_name`, type: 'text' },
  clientPoNo: { sql: sql`jw.client_po_no`, type: 'text' },
  totalQty: { sql: sql`COALESCE(agg.total_qty, 0)::int`, type: 'num' },
  jcQty: { sql: sql`COALESCE(jca.jc_qty, 0)::int`, type: 'num' },
  dispatchedQty: { sql: sql`COALESCE(agg.dispatched_qty, 0)::int`, type: 'num' },
  // ADR-303 — Pending as the cell prints it: per line, 0 once closed short /
  // cancelled, never below zero (agg.pending_qty).
  pendingQty: { sql: sql`COALESCE(agg.pending_qty, 0)::int`, type: 'num' },
  earliestDueDate: { sql: sql`agg.earliest_due`, type: 'date' },
  status: { sql: sql`jw.status`, type: 'list' },
  // ADR-303 — one row per JWSO again: Lines, Created On, Created By.
  lineCount: { sql: sql`COALESCE(agg.line_count, 0)::int`, type: 'num' },
  createdOn: { sql: sql`(jw.created_at AT TIME ZONE 'Asia/Kolkata')::date`, type: 'date' },
  createdBy: { sql: createdByNameSql(sql`jw.created_by`), type: 'text' },
};

// ADR-261 — the JWSO list ONE ROW PER LINE (list-lines.ts, aliases l / jw / i /
// jca). Old header-list field names kept where the line has the same fact so a
// sort saved for the tab keeps working: totalQty = the line's Order Qty,
// earliestDueDate = the line's Due.
export const JWSO_LINE_SF_COLUMNS: SfColumnMap = {
  code: { sql: sql`jw.code`, type: 'text' },
  jwDate: { sql: sql`jw.jw_date`, type: 'date' },
  customerName: { sql: sql`jw.customer_name`, type: 'text' },
  clientPoNo: { sql: sql`jw.client_po_no`, type: 'text' },
  clientPoLineNo: { sql: sql`l.client_po_line_no`, type: 'text' },
  createdOn: {
    sql: sql`(COALESCE(l.created_at, jw.created_at) AT TIME ZONE 'Asia/Kolkata')::date`,
    type: 'date',
  },
  createdBy: { sql: createdByNameSql(sql`COALESCE(l.created_by, jw.created_by)`), type: 'text' },
  // CODE/REV as the cell prints it.
  itemCode: {
    sql: sql`(btrim(COALESCE(i.code, l.item_code_text)) || COALESCE('/' || NULLIF(btrim(l.revision), ''), ''))`,
    type: 'text',
  },
  itemName: { sql: sql`COALESCE(NULLIF(btrim(l.part_name), ''), i.name)`, type: 'text' },
  totalQty: { sql: sql`l.order_qty`, type: 'num' },
  jcQty: { sql: sql`COALESCE(jca.jc_qty, 0)::int`, type: 'num' },
  dispatchedQty: { sql: sql`COALESCE(l.returned_qty, 0)`, type: 'num' },
  // Same rule as the row value + the SO line: 0 once closed short / cancelled.
  pendingQty: {
    sql: sql`(CASE WHEN l.short_closed_at IS NOT NULL OR l.status = 'cancelled' THEN 0
                   ELSE GREATEST(0, l.order_qty - COALESCE(l.returned_qty, 0)) END)`,
    type: 'num',
  },
  earliestDueDate: { sql: sql`l.due_date`, type: 'date' },
  status: { sql: sql`jw.status`, type: 'list' },
  // ADR-303 — the per-JWSO screen's Lines (same tableKey): the JWSO's count.
  lineCount: {
    sql: sql`(SELECT COUNT(*)::int FROM public.job_work_order_lines lc
              WHERE lc.job_work_order_id = jw.id AND lc.deleted_at IS NULL)`,
    type: 'num',
  },
};
