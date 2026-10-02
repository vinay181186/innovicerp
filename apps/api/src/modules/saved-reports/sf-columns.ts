// Sort & Filter (ADR-200) — the Saved Reports list's fields. listSavedReports
// reads saved_reports LEFT JOIN users (the owner), list and count over the
// same WHERE, so each expression is the column the row shows. Source is the
// stored source key (the screen ticks from the source catalog's labels);
// Shared is the stored flag as 'true' / 'false'.

import { sql } from 'drizzle-orm';

import { savedReports, users } from '../../db/schema';
import type { SfColumnMap } from '../../lib/list-query';

export const SAVED_REPORT_SF_COLUMNS: SfColumnMap = {
  name: { sql: sql`${savedReports.name}`, type: 'text' },
  description: { sql: sql`${savedReports.description}`, type: 'text' },
  source: { sql: sql`${savedReports.sourceKey}`, type: 'list' },
  isShared: { sql: sql`${savedReports.isShared}::text`, type: 'list' },
  owner: { sql: sql`${users.email}`, type: 'text' },
};
