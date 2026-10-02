// Sort & Filter (ADR-200) — the Cost Centre Master list's sortable /
// filterable fields. listCostCenters reads the cost_centers table alone
// (drizzle builder), list and count over the same WHERE, so every expression
// is a cost_centers column. Active is the boolean as text ('true' / 'false').

import { sql } from 'drizzle-orm';

import { costCenters } from '../../db/schema';
import type { SfColumnMap } from '../../lib/list-query';

export const COST_CENTER_SF_COLUMNS: SfColumnMap = {
  code: { sql: sql`${costCenters.code}`, type: 'text' },
  name: { sql: sql`${costCenters.name}`, type: 'text' },
  department: { sql: sql`${costCenters.department}`, type: 'list' },
  type: { sql: sql`${costCenters.type}`, type: 'list' },
  description: { sql: sql`${costCenters.description}`, type: 'text' },
  isActive: { sql: sql`${costCenters.isActive}`, type: 'list' },
};
