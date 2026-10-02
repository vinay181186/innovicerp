// Sort & Filter (ADR-200) — the Operator Master list's sortable / filterable
// fields. listOperators reads the operators table alone (drizzle builder),
// list and count over the same WHERE, so every expression is an operators
// column. Active is the boolean as text ('true' / 'false').

import { sql } from 'drizzle-orm';

import { operators } from '../../db/schema';
import type { SfColumnMap } from '../../lib/list-query';

export const OPERATOR_SF_COLUMNS: SfColumnMap = {
  code: { sql: sql`${operators.code}`, type: 'text' },
  name: { sql: sql`${operators.name}`, type: 'text' },
  department: { sql: sql`${operators.department}`, type: 'text' },
  skills: { sql: sql`${operators.skills}`, type: 'text' },
  isActive: { sql: sql`${operators.isActive}`, type: 'list' },
};
