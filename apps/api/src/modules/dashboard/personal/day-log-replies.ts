// ADR-255 — Day Log replies as Home Notifications (ADR-250). A Super Admin's
// reply on one of the caller's Day Log entries is a note until the caller
// opens that entry (seen_at): no 3-day window, never cut by NOTE_MAX, and
// also for admin / Full Access callers (notifications.ts merges these first).
// An edited reply has seen_at reset, so it comes back as a new note (the key
// carries updated_at).

import type { DashNote } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { DbTransaction } from '../../../db/with-user-context';

export interface DayLogReplyRow {
  id: string;
  lineId: string;
  /** YYYY-MM-DD — the entry's day. */
  date: string;
  /** The entry's Sr No that day (by Start Time). */
  srNo: number;
  author: string;
  body: string;
  sentAt: string;
  editedAt: string | null;
  updatedAt: string;
}

const BODY_MAX = 60;

const dmy = (d: string): string => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;

/** One reply → its note (pure — unit-tested). */
export function dayLogReplyNote(r: DayLogReplyRow): DashNote {
  const body = r.body.length > BODY_MAX ? `${r.body.slice(0, BODY_MAX)}…` : r.body;
  return {
    key: `dlr:${r.id}:${Date.parse(r.updatedAt)}`,
    ts: r.editedAt ?? r.sentAt,
    tone: 'due',
    text: [
      { text: `${r.author} ${r.editedAt ? 'edited a reply on' : 'replied on'} your Day Log · ` },
      {
        code: `${dmy(r.date)} · entry ${r.srNo}`,
        href: `/task-board?view=daylog&date=${r.date}&line=${r.lineId}`,
      },
      { text: ` — “${body}”` },
    ],
    unseen: true,
  };
}

const iso = (v: unknown): string => (v instanceof Date ? v : new Date(String(v))).toISOString();

/** The caller's unseen replies, newest first — ONE statement. */
export async function readDayLogReplies(
  tx: DbTransaction,
  cid: string,
  me: string,
): Promise<DayLogReplyRow[]> {
  const rows = (await tx.execute(sql`
    SELECT rp.id::text AS id, rp.line_id::text AS line_id,
           to_char(dr.report_date, 'YYYY-MM-DD') AS date,
           (SELECT count(*) FROM public.daily_report_lines o
            WHERE o.daily_report_id = l.daily_report_id AND o.deleted_at IS NULL
              AND o.from_time IS NOT NULL
              AND (o.from_time, o.line_no) <= (l.from_time, l.line_no))::int AS sr_no,
           COALESCE(au.full_name, au.email) AS author, rp.body,
           rp.sent_at, rp.edited_at, rp.updated_at
    FROM public.daily_report_line_replies rp
    JOIN public.daily_report_lines l ON l.id = rp.line_id AND l.deleted_at IS NULL
    JOIN public.daily_reports dr ON dr.id = l.daily_report_id AND dr.deleted_at IS NULL
    JOIN public.users au ON au.id = rp.created_by
    WHERE rp.company_id = ${cid}::uuid AND rp.deleted_at IS NULL AND rp.seen_at IS NULL
      AND rp.created_by <> ${me}::uuid
      AND dr.company_id = ${cid}::uuid AND dr.user_id = ${me}::uuid
    ORDER BY COALESCE(rp.edited_at, rp.sent_at) DESC
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r['id']),
    lineId: String(r['line_id']),
    date: String(r['date']),
    srNo: Number(r['sr_no'] ?? 0),
    author: String(r['author'] ?? 'Someone'),
    body: String(r['body'] ?? ''),
    sentAt: iso(r['sent_at']),
    editedAt: r['edited_at'] ? iso(r['edited_at']) : null,
    updatedAt: iso(r['updated_at']),
  }));
}
