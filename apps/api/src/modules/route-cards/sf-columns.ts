// Sort & Filter (ADR-200) — the Route Card list's sortable / filterable fields.
// Each expression is the SAME one listRouteCards SELECTs for that column (same
// aliases — rc, i, op_agg — used by both its list and its count query).

import { sql } from 'drizzle-orm';

import type { SfColumnMap } from '../../lib/list-query';

export const RC_SF_COLUMNS: SfColumnMap = {
  code: { sql: sql`rc.code`, type: 'text' },
  itemCode: { sql: sql`i.code`, type: 'text' },
  itemName: { sql: sql`i.name`, type: 'text' },
  // "RM Grade / RM Size" as the cell prints it.
  rawMaterial: {
    sql: sql`(COALESCE(rc.raw_material_grade_text, '—') || ' / ' || COALESCE(rc.raw_material_size_text, '—'))`,
    type: 'text',
  },
  opCount: { sql: sql`COALESCE(op_agg.op_count, 0)`, type: 'num' },
  currentRevision: { sql: sql`rc.current_revision`, type: 'num' },
  updatedOn: { sql: sql`(rc.updated_at AT TIME ZONE 'Asia/Kolkata')::date`, type: 'date' },
};
