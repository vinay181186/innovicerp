// Sort & Filter (ADR-200) — the Stock Count list's sortable / filterable
// fields. Each expression is the SAME one listStockCounts SELECTs for that
// column (same aliases; its count query carries the same two users joins), so
// what the user filters is what the row shows.

import { sql } from 'drizzle-orm';

import type { SfColumnMap } from '../../lib/list-query';

export const STOCK_COUNT_SF_COLUMNS: SfColumnMap = {
  code: { sql: sql`sc.code`, type: 'text' },
  countDate: { sql: sql`sc.count_date`, type: 'date' },
  purpose: { sql: sql`sc.purpose`, type: 'list' },
  lineCount: {
    sql: sql`(SELECT COUNT(*)::int FROM public.stock_count_lines l
      WHERE l.stock_count_id = sc.id AND l.deleted_at IS NULL)`,
    type: 'num',
  },
  status: { sql: sql`sc.status`, type: 'list' },
  countedBy: { sql: sql`cu.full_name`, type: 'text' },
  approvedBy: { sql: sql`au.full_name`, type: 'text' },
  remarks: { sql: sql`sc.remarks`, type: 'text' },
  createdOn: { sql: sql`(sc.created_at AT TIME ZONE 'Asia/Kolkata')::date`, type: 'date' },
};
