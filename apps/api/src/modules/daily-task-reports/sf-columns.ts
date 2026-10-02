// Sort & Filter (ADR-200) — the Daily Task Reports list's sortable / filterable
// fields. The expressions use listDailyReports' FROM (dr = daily_reports,
// u = users, agg = the per-report line sums), shared by its page and its count.

import { SHIFT_LABELS, SHIFTS } from '@innovic/shared';
import { sql } from 'drizzle-orm';

import type { SfColumnMap } from '../../lib/list-query';

/** The Shift as the screen prints it (SHIFT_LABELS), for the search. */
export const DTR_SHIFT_LABEL = sql`(CASE dr.shift::text ${sql.join(
  SHIFTS.map((s) => sql`WHEN ${s} THEN ${SHIFT_LABELS[s]}`),
  sql` `,
)} ELSE dr.shift::text END)`;

export const DTR_SF_COLUMNS: SfColumnMap = {
  reportDate: { sql: sql`dr.report_date`, type: 'date' },
  user: { sql: sql`u.full_name`, type: 'text' },
  shift: { sql: sql`dr.shift`, type: 'list' },
  taskCount: { sql: sql`agg.n`, type: 'num' },
  totalHours: { sql: sql`agg.h`, type: 'num' },
};
