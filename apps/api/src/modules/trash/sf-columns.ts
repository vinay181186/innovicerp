// Sort & Filter (ADR-200) — the Trash list's sortable / filterable fields.
// Every expression reads the UNION ALL derived row `t` (id / type / label /
// deleted_at / deleted_by_name), the very row the list shows; the list, its
// count and the per-type counts all select from that same `t`.

import { sql } from 'drizzle-orm';

import type { SfColumnMap } from '../../lib/list-query';

export const TRASH_SF_COLUMNS: SfColumnMap = {
  document: { sql: sql`t.label`, type: 'text' },
  // The stored type code ('Client', 'Cost Center', …); the screen ticks it by label.
  type: { sql: sql`t.type`, type: 'list' },
  deletedBy: { sql: sql`t.deleted_by_name`, type: 'text' },
  // An India day, so "Deleted At = today" means today in IST.
  deletedAt: { sql: sql`(t.deleted_at AT TIME ZONE 'Asia/Kolkata')::date`, type: 'date' },
};
