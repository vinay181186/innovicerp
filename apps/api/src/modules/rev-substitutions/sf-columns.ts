// Sort & Filter (ADR-200) — the Rev Substitutions list (ADR-292). Each
// expression is the SAME one listRevSubstitutions SELECTs (aliases rs, i, fr,
// tr, au, sl, sh, wl, wh, jc).

import { sql } from 'drizzle-orm';

import type { SfColumnMap } from '../../lib/list-query';

export const REV_SUBSTITUTION_SF_COLUMNS: SfColumnMap = {
  itemCode: { sql: sql`i.code`, type: 'text' },
  fromLabel: { sql: sql`(i.code || '/' || fr.rev)`, type: 'text' },
  toLabel: { sql: sql`(i.code || '/' || tr.rev)`, type: 'text' },
  scopeLabel: {
    sql: sql`COALESCE(sh.code || ' Ln ' || sl.line_no, wh.code || ' Ln ' || wl.line_no, jc.code)`,
    type: 'text',
  },
  qtyAllowed: { sql: sql`rs.qty_allowed`, type: 'num' },
  qtyUsed: { sql: sql`rs.qty_used`, type: 'num' },
  reason: { sql: sql`rs.reason`, type: 'text' },
  approvedByName: {
    sql: sql`COALESCE(NULLIF(btrim(au.full_name), ''), split_part(au.email, '@', 1))`,
    type: 'text',
  },
  approvedAt: {
    sql: sql`(rs.approved_at AT TIME ZONE 'Asia/Kolkata')::date`,
    sortSql: sql`rs.approved_at`,
    type: 'date',
  },
};
