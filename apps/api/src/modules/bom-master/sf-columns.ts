// Sort & Filter (ADR-200) — the BOM Master list's sortable / filterable fields.
// Each expression is the SAME one listBomMasters SELECTs for that column (same
// aliases — b, pi, line_agg, so_agg — used by both its list and count query).

import { sql } from 'drizzle-orm';

import type { SfColumnMap } from '../../lib/list-query';

export const BOM_SF_COLUMNS: SfColumnMap = {
  bomNo: { sql: sql`b.bom_no`, type: 'text' },
  bomName: { sql: sql`b.bom_name`, type: 'text' },
  parentItemCode: { sql: sql`pi.code`, type: 'text' },
  parentItemName: { sql: sql`pi.name`, type: 'text' },
  lineCount: { sql: sql`COALESCE(line_agg.line_count, 0)`, type: 'num' },
  revision: { sql: sql`b.revision`, type: 'num' },
  revisionDate: { sql: sql`b.revision_date`, type: 'date' },
  linkedSoCount: { sql: sql`COALESCE(so_agg.linked_so_count, 0)`, type: 'num' },
  status: { sql: sql`b.status`, type: 'list' },
};
