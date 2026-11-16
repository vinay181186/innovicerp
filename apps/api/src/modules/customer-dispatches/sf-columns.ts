// Sort & Filter (ADR-200 / ADR-201) — the Customer Dispatch register's
// sortable / filterable fields, one per DISPATCH column on screen. Aliases are
// those of register.ts (h = dispatch, cli = live customer, u = creator).
// Billed Status and Lines are worked out per page and are not here.

import { sql } from 'drizzle-orm';

import { createdByNameSql } from '../../lib/created-by-sql';
import type { SfColumnMap, SfLiftSpec } from '../../lib/list-query';

export const DISPATCH_SF_COLUMNS: SfColumnMap = {
  dispatchCode: { sql: sql`h.code`, type: 'text' },
  dispatchDate: { sql: sql`h.dispatch_date`, type: 'date' },
  customer: { sql: sql`COALESCE(cli.name, h.customer_text)`, type: 'text' },
  // ADR-267 — the live SO first, the snapshot as the fallback (the `cso` join is
  // in HEADER_JOINS, which every query reading this map makes).
  soCode: { sql: sql`COALESCE(cso.code, h.so_code_text)`, type: 'text' },
  // ADR-207 — the Internal SO No., live off the dispatch's SO (the `cso` join
  // HEADER_JOINS already makes, so the dispatch page and its count agree).
  soInternalNo: { sql: sql`cso.internal_so_no`, type: 'text' },
  // Every live line of the dispatch.
  totalQty: {
    sql: sql`(SELECT COALESCE(SUM(sfl.qty), 0) FROM public.customer_dispatch_lines sfl
      WHERE sfl.customer_dispatch_id = h.id AND sfl.deleted_at IS NULL)`,
    type: 'num',
  },
  dispatchedBy: { sql: sql`u.full_name`, type: 'text' },
  status: { sql: sql`h.status`, type: 'list' },
  // ADR-303 — one row per DISPATCH again: Lines, Created On, Created By.
  lineCount: {
    sql: sql`(SELECT COUNT(*)::int FROM public.customer_dispatch_lines sfc
      WHERE sfc.customer_dispatch_id = h.id AND sfc.deleted_at IS NULL)`,
    type: 'num',
  },
  createdOn: { sql: sql`(h.created_at AT TIME ZONE 'Asia/Kolkata')::date`, type: 'date' },
  createdBy: { sql: createdByNameSql(sql`h.created_by`), type: 'text' },
};

/**
 * ADR-303 / ADR-267 — SO No. / Internal SO No. filters (the SO dropdown too) on
 * the per-DISPATCH list: judged over the dispatch's own SO (`cso`, HEADER_JOINS)
 * AND the SO of every live line (lib/list-query liftLineFilters), so each
 * dispatch stays one row.
 */
export const DISPATCH_LINE_LIFT: SfLiftSpec = {
  fields: {
    soCode: { header: sql`COALESCE(cso.code, h.so_code_text)`, line: sql`sso.code`, type: 'text' },
    soInternalNo: { header: sql`cso.internal_so_no`, line: sql`sso.internal_so_no`, type: 'text' },
  },
  linesFrom: sql`FROM public.customer_dispatch_lines sl
    JOIN public.sales_order_lines ssol ON ssol.id = sl.sales_order_line_id
    JOIN public.sales_orders sso ON sso.id = ssol.sales_order_id
    WHERE sl.customer_dispatch_id = h.id AND sl.deleted_at IS NULL`,
};

// ADR-261 — GET /customer-dispatches/lines (one row per DISPATCH LINE). Every
// dispatch field above stays valid; the line fields use register.ts's line
// aliases (l = dispatch line, i = item, sol = its SO line).
export const DISPATCH_LINE_SF_COLUMNS: SfColumnMap = {
  ...DISPATCH_SF_COLUMNS,
  clientPoLineNo: { sql: sql`sol.client_po_line_no`, type: 'text' },
  createdOn: {
    sql: sql`(COALESCE(l.created_at, h.created_at) AT TIME ZONE 'Asia/Kolkata')::date`,
    type: 'date',
  },
  createdBy: { sql: createdByNameSql(sql`COALESCE(l.created_by, h.created_by)`), type: 'text' },
  itemCode: { sql: sql`COALESCE(i.code, l.item_code_text)`, type: 'text' },
  itemName: { sql: sql`l.item_name`, type: 'text' },
  qty: { sql: sql`l.qty`, type: 'num' },
};
