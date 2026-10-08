// Sort & Filter (ADR-200) — the Multi-Level BOM list's sortable / filterable
// fields. Each expression is the SAME one listMlBoms SELECTs for that column
// (same aliases — b, bi, line_agg, lv — used by both its list and count query).

import { sql } from 'drizzle-orm';

import type { SfColumnMap } from '../../lib/list-query';

export const ML_BOM_SF_COLUMNS: SfColumnMap = {
  code: { sql: sql`b.code`, type: 'text' },
  itemCode: { sql: sql`bi.code`, type: 'text' },
  itemName: { sql: sql`bi.name`, type: 'text' },
  revision: { sql: sql`b.revision`, type: 'num' },
  lineCount: { sql: sql`COALESCE(line_agg.line_count, 0)`, type: 'num' },
  subAssemblyCount: { sql: sql`COALESCE(line_agg.sub_count, 0)`, type: 'num' },
  levels: { sql: sql`COALESCE(lv.levels, 0)`, type: 'num' },
};
