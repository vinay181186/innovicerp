// Sort & Filter (ADR-200) — the Design Tracker list's sortable / filterable
// fields. listDesignTracker reads design_tracker dt with the SO-line (soline)
// and booked-hours (tl) LATERALs for its list, its count and its filter
// counts alike, so every expression is the one the SELECT shows for that
// column. Item Code is printed as CODE/REV (itemCodeWithRev): the item code,
// then the customer's drawing revision off the SO line after a slash.

import { sql } from 'drizzle-orm';

import type { SfColumnMap } from '../../lib/list-query';

export const TRACKER_HOURS_SQL = sql`COALESCE(tl.total_hours, 0)::float`;

export const DESIGN_TRACKER_SF_COLUMNS: SfColumnMap = {
  code: { sql: sql`dt.code`, type: 'text' },
  soCode: { sql: sql`dt.so_code_text`, type: 'text' },
  // ADR-207 — the Internal SO No., off the so_i join the list's one shared
  // FROM makes (page, count and the status counts alike).
  soInternalNo: { sql: sql`so_i.internal_so_no`, type: 'text' },
  clientPoLineNo: { sql: sql`soline."clientPoLineNo"`, type: 'text' },
  itemCode: {
    sql: sql`(dt.item_code_text || COALESCE('/' || NULLIF(btrim(soline."itemRevision"), ''), ''))`,
    type: 'text',
  },
  itemName: { sql: sql`dt.item_name_text`, type: 'text' },
  designer: { sql: sql`dt.designer`, type: 'text' },
  dueDate: { sql: sql`dt.target_date`, type: 'date' },
  status: { sql: sql`dt.status`, type: 'list' },
  revision: { sql: sql`dt.revision`, type: 'num' },
  bookedHours: { sql: TRACKER_HOURS_SQL, type: 'num' },
  estimatedHours: { sql: sql`dt.estimated_hours`, type: 'num' },
};
