// Sort & Filter (ADR-200) — the Multi-Level Plan list's sortable / filterable
// fields. Each expression is the SAME one listMlPlansTx SELECTs for that
// column (aliases mp, so, i, b, na — used by both its list and count query).

import { sql } from 'drizzle-orm';

import type { SfColumnMap } from '../../lib/list-query';

export const ML_PLAN_SF_COLUMNS: SfColumnMap = {
  code: { sql: sql`mp.code`, type: 'text' },
  soCode: { sql: sql`so.code`, type: 'text' },
  itemCode: { sql: sql`i.code`, type: 'text' },
  itemName: { sql: sql`i.name`, type: 'text' },
  planQty: { sql: sql`mp.plan_qty`, type: 'num' },
  status: { sql: sql`mp.status`, type: 'list' },
  mlBomCode: { sql: sql`b.code`, type: 'text' },
  levels: { sql: sql`COALESCE(na.levels, 0)`, type: 'num' },
  nodeCount: { sql: sql`COALESCE(na.node_count, 0)`, type: 'num' },
};
