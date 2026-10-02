// Sort & Filter (ADR-200) + search — the Approval Activity table's fields.
// getApprovalHistory reads activity_log LEFT JOIN users, list and count over
// the same WHERE, so each expression is what the row shows: the action and
// document-type WORDS the screen prints (approval-history-table.tsx), the
// detail text and the user's name. Action Date & Time is an India-time date.

import { sql } from 'drizzle-orm';

import { activityLog, users } from '../../db/schema';
import type { SfColumnMap } from '../../lib/list-query';

/** The action word the screen prints for APPROVE / REJECT / PAYMENT. */
export const HISTORY_ACTION_LABEL = sql`(CASE ${activityLog.action}
  WHEN 'APPROVE' THEN 'Approved' WHEN 'REJECT' THEN 'Rejected'
  WHEN 'PAYMENT' THEN 'Payment' ELSE ${activityLog.action} END)`;

/** The document-type word: 'PurchaseRequest' is stored as a raw code. */
export const HISTORY_ENTITY_LABEL = sql`(CASE ${activityLog.entity}
  WHEN 'PurchaseRequest' THEN 'Purchase Request'
  ELSE regexp_replace(${activityLog.entity}, '([a-z])([A-Z])', '\\1 \\2', 'g') END)`;

export const HISTORY_SF_COLUMNS: SfColumnMap = {
  ts: { sql: sql`(${activityLog.ts} AT TIME ZONE 'Asia/Kolkata')::date`, type: 'date' },
  action: { sql: sql`${activityLog.action}`, type: 'list' },
  entity: { sql: HISTORY_ENTITY_LABEL, type: 'text' },
  detail: { sql: sql`COALESCE(${activityLog.detail}, '')`, type: 'text' },
  user: { sql: sql`${users.fullName}`, type: 'text' },
};
