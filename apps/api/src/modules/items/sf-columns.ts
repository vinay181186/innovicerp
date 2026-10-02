// Sort & Filter (ADR-200) — the Item Master list's sortable / filterable
// fields. listItems reads the items table alone (drizzle builder), list and
// count over the same WHERE, so every expression is an items column, exactly
// what the screen's cell shows.

import { sql } from 'drizzle-orm';

import { items } from '../../db/schema';
import type { SfColumnMap } from '../../lib/list-query';

export const ITEM_SF_COLUMNS: SfColumnMap = {
  code: { sql: sql`${items.code}`, type: 'text' },
  name: { sql: sql`${items.name}`, type: 'text' },
  description: { sql: sql`${items.description}`, type: 'text' },
  material: { sql: sql`${items.material}`, type: 'text' },
  uom: { sql: sql`${items.uom}`, type: 'list' },
  procurementType: { sql: sql`${items.procurementType}`, type: 'list' },
};
