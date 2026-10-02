// Sort & Filter (ADR-200) — the Customer Material Master's sortable /
// filterable fields. Each expression is the SAME one listPartyMaterials
// SELECTs for that column (same aliases `pm`, `c`; its count query carries the
// same joins), so what the user filters is what the row shows.

import { sql } from 'drizzle-orm';

import type { SfColumnMap } from '../../lib/list-query';

export const PARTY_MATERIAL_SF_COLUMNS: SfColumnMap = {
  code: { sql: sql`pm.code`, type: 'text' },
  name: { sql: sql`pm.name`, type: 'text' },
  uom: { sql: sql`pm.uom`, type: 'text' },
  customer: { sql: sql`COALESCE(c.name, pm.client_code_text)`, type: 'text' },
  stockQty: { sql: sql`pm.stock_qty`, type: 'num' },
  issuedQty: { sql: sql`pm.issued_qty`, type: 'num' },
  createdOn: { sql: sql`(pm.created_at AT TIME ZONE 'Asia/Kolkata')::date`, type: 'date' },
};
