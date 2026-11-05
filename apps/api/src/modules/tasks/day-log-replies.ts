// ADR-274 — the Day Log replies a task shows, read LIVE from the reply tables: the
// text is never copied to tasks / task_comments / task_history (those are readable
// company-wide; ADR-255 keeps it private). Whoever may see the task sees them.
//
// A task holds only its own sender's replies of its own life: from the moment it
// was raised until the next task of the same entry / date / sender was raised. The
// end is deliberately NOT the task's updated_at: a status change stamps that from
// the API's clock and sent_at comes from the database's, and those differ (measured
// 1.3 s on 05-11-2026). Replies are stamped under the day lock (clock_timestamp), so
// each one lands in exactly one task. created_at is the database's now() as well.

import {
  DAY_LOG_DATE_REF,
  DAY_LOG_ENTRY_REF,
  type TaskDayLogReply,
  isDayLogReplyRef,
} from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
import type { DbTransaction } from '../../db/with-user-context';
import { ts } from '../day-logs/day';
import type { TaskRecord } from './history';

/** The replies of one kind for the tasks in `t`; `parent` = the reply's own link. */
const repliesOf = (table: string, parent: string, refType: string, companyId: string): SQL => sql`
  SELECT t.id::text AS task_id, rp.id::text AS id, rp.body,
    COALESCE(au.full_name, au.email) AS author_name,
    ${ts('rp.sent_at')} AS sent_at,
    CASE WHEN rp.edited_at IS NULL THEN NULL ELSE ${ts('rp.edited_at')} END AS edited_at,
    CASE WHEN rp.seen_at IS NULL THEN NULL ELSE ${ts('rp.seen_at')} END AS seen_at
  FROM t
  JOIN ${sql.raw(`public.${table}`)} rp
    ON rp.${sql.raw(parent)}::text = t.linked_ref_id AND rp.created_by = t.created_by
  JOIN public.users au ON au.id = rp.created_by
  WHERE t.linked_ref_type = ${refType} AND rp.company_id = ${companyId}::uuid
    AND rp.deleted_at IS NULL AND rp.sent_at >= t.created_at
    AND (t.next_at IS NULL OR rp.sent_at < t.next_at)`;

/** taskId → its replies, oldest first. No query when no row is a reply task. */
export async function loadDayLogReplies(
  tx: DbTransaction,
  companyId: string,
  rows: readonly Pick<TaskRecord, 'id' | 'linkedRefType'>[],
): Promise<Map<string, TaskDayLogReply[]>> {
  const out = new Map<string, TaskDayLogReply[]>();
  const ids = rows.filter((r) => isDayLogReplyRef(r.linkedRefType)).map((r) => r.id);
  if (ids.length === 0) return out;
  const found = (await tx.execute(sql`
    WITH t AS (
      SELECT tk.id, tk.linked_ref_type, tk.linked_ref_id, tk.created_by, tk.created_at,
        (SELECT min(n.created_at) FROM public.tasks n
         WHERE n.company_id = tk.company_id AND n.linked_ref_type = tk.linked_ref_type
           AND n.linked_ref_id = tk.linked_ref_id AND n.created_by = tk.created_by
           AND n.deleted_at IS NULL AND n.created_at > tk.created_at) AS next_at
      FROM public.tasks tk
      WHERE tk.company_id = ${companyId}::uuid AND tk.id = ANY(${sql.param(ids)}::uuid[]))
    ${repliesOf('daily_report_line_replies', 'line_id', DAY_LOG_ENTRY_REF, companyId)}
    UNION ALL
    ${repliesOf('daily_report_day_replies', 'daily_report_id', DAY_LOG_DATE_REF, companyId)}
    ORDER BY sent_at, id
  `)) as unknown as Array<Record<string, string | null>>;
  for (const r of found) {
    const taskId = String(r['task_id']);
    out.set(taskId, [
      ...(out.get(taskId) ?? []),
      {
        id: String(r['id']),
        body: String(r['body']),
        authorName: String(r['author_name'] ?? ''),
        sentAt: String(r['sent_at']),
        editedAt: r['edited_at'] ?? null,
        seenAt: r['seen_at'] ?? null,
      },
    ]);
  }
  return out;
}
