// Sort & Filter (ADR-200) — the All Design Issues list's sortable / filterable
// fields. listDesignIssuesAll reads design_issues di LEFT JOIN design_projects
// dp for its list, its count and its filter counts alike, so every expression
// is the one the SELECT shows for that column.

import { sql } from 'drizzle-orm';

import type { SfColumnMap } from '../../lib/list-query';

/** Days Open as the SELECT computes it. */
export const ISSUE_AGE_DAYS_SQL = sql`GREATEST(0, (CURRENT_DATE - di.raised_date))::int`;

export const DESIGN_ISSUE_SF_COLUMNS: SfColumnMap = {
  title: { sql: sql`di.title`, type: 'text' },
  projectName: { sql: sql`dp.project_name`, type: 'text' },
  severity: { sql: sql`di.severity`, type: 'list' },
  status: { sql: sql`di.status`, type: 'list' },
  assignedTo: { sql: sql`di.assigned_to_text`, type: 'text' },
  raisedDate: { sql: sql`di.raised_date`, type: 'date' },
  ageDays: { sql: ISSUE_AGE_DAYS_SQL, type: 'num' },
};
