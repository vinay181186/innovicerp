// Sort & Filter (ADR-200 / ADR-201) — the Customer Dispatch register's
// sortable / filterable fields, one per DISPATCH column on screen. Aliases are
// those of register.ts (h = dispatch, cli = live customer, u = creator).
// Billed Status and Lines are worked out per page and are not here.

import { sql } from 'drizzle-orm';

import type { SfColumnMap } from '../../lib/list-query';

export const DISPATCH_SF_COLUMNS: SfColumnMap = {
  dispatchCode: { sql: sql`h.code`, type: 'text' },
  dispatchDate: { sql: sql`h.dispatch_date`, type: 'date' },
  customer: { sql: sql`COALESCE(cli.name, h.customer_text)`, type: 'text' },
  soCode: { sql: sql`h.so_code_text`, type: 'text' },
  // Every live line of the dispatch.
  totalQty: {
    sql: sql`(SELECT COALESCE(SUM(sfl.qty), 0) FROM public.customer_dispatch_lines sfl
      WHERE sfl.customer_dispatch_id = h.id AND sfl.deleted_at IS NULL)`,
    type: 'num',
  },
  dispatchedBy: { sql: sql`u.full_name`, type: 'text' },
  status: { sql: sql`h.status`, type: 'list' },
};
