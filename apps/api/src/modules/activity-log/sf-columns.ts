// Sort & Filter (ADR-200) — the Activity Log list's sortable / filterable
// fields. Each expression is the SAME one the list shows for that column,
// written against `activity_log` and the `users` join that BOTH the list and
// its count query carry. Log Date / Log Time / Created On are India-time
// (CLAUDE.md §6.5): a filter on 26-Sep means the 26th as the user reads it.

import { sql } from 'drizzle-orm';

import { activityLog, users } from '../../db/schema';
import type { SfColumnMap } from '../../lib/list-query';

export const ACTIVITY_LOG_SF_COLUMNS: SfColumnMap = {
  logDate: { sql: sql`(${activityLog.ts} AT TIME ZONE 'Asia/Kolkata')::date`, type: 'date' },
  logTime: {
    sql: sql`to_char(${activityLog.ts} AT TIME ZONE 'Asia/Kolkata', 'HH24:MI')`,
    type: 'text',
  },
  action: { sql: sql`${activityLog.action}`, type: 'list' },
  entity: { sql: sql`${activityLog.entity}`, type: 'text' },
  detail: { sql: sql`${activityLog.detail}`, type: 'text' },
  refId: { sql: sql`${activityLog.refId}`, type: 'text' },
  // The User column: the row's snapshot, else today's full name, else the
  // e-mail (rowToEntry's order).
  userName: {
    sql: sql`COALESCE(${activityLog.userFullName}, ${users.fullName}, ${activityLog.userName})`,
    type: 'text',
  },
  createdOn: {
    sql: sql`(${activityLog.createdAt} AT TIME ZONE 'Asia/Kolkata')::date`,
    type: 'date',
  },
};
