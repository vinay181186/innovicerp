// ADR-255 — Day Log replies as Home Notifications (ADR-250). A Super Admin's
// reply on one of the caller's Day Log entries is a note until the caller
// opens that entry (seen_at): no 3-day window, never cut by NOTE_MAX, and
// also for admin / Full Access callers (notifications.ts merges these first).
// An edited reply has seen_at reset, so it comes back as a new note (the key
// carries updated_at).
//
// Pending Entries (owner 2026-11-05) — three more of the same kind, read in ONE
// statement (the bell polls every 60 s): a reply on a blank day until that date
// is opened; "N days not entered" for an eligible person; "N people have pending
// entries" for a Super Admin. The last two stay until the days are entered: their
// key (PENDING_NOTE_PREFIX) always reads unread in the bell, and carries the count.

import type { DashNote } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { DbTransaction } from '../../../db/with-user-context';
import { pendingColumns, pendingOf } from '../../day-logs/pending';

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

/** The wording every reply note shares. */
function replyNote(
  r: Pick<DayLogReplyRow, 'id' | 'author' | 'body' | 'sentAt' | 'editedAt' | 'updatedAt'>,
  keyPrefix: string,
  code: string,
  href: string,
): DashNote {
  const body = r.body.length > BODY_MAX ? `${r.body.slice(0, BODY_MAX)}…` : r.body;
  return {
    key: `${keyPrefix}:${r.id}:${Date.parse(r.updatedAt)}`,
    ts: r.editedAt ?? r.sentAt,
    tone: 'due',
    text: [
      { text: `${r.author} ${r.editedAt ? 'edited a reply on' : 'replied on'} your Day Log · ` },
      { code, href },
      { text: ` — “${body}”` },
    ],
    unseen: true,
  };
}

/** One reply → its note (pure — unit-tested). */
export const dayLogReplyNote = (r: DayLogReplyRow): DashNote =>
  replyNote(
    r,
    'dlr',
    `${dmy(r.date)} · entry ${r.srNo}`,
    `/task-board?view=daylog&date=${r.date}&line=${r.lineId}`,
  );

export type DayLogDayReplyRow = Omit<DayLogReplyRow, 'lineId' | 'srNo'>;

/** One reply on a blank day → its note (pure — unit-tested). */
export const dayLogDayReplyNote = (r: DayLogDayReplyRow): DashNote =>
  replyNote(r, 'dlr:d', dmy(r.date), `/task-board?view=daylog&date=${r.date}`);

/** Keys of the notes that stay unread while days are blank (notifications-service). */
export const PENDING_NOTE_PREFIX = 'dlp:';

/** An eligible person's pending dates (oldest first, at least one) → the note. */
export function dayLogPendingNote(dates: readonly string[], now: string): DashNote {
  const n = dates.length;
  const oldest = dates[0]!;
  return {
    key: `${PENDING_NOTE_PREFIX}me:${n}:${oldest}`,
    ts: now,
    tone: 'late',
    text: [
      { text: `Day Log — ${n} ${n === 1 ? 'day' : 'days'} not entered · ` },
      { code: dates.map(dmy).join(', '), href: `/task-board?view=daylog&date=${oldest}` },
    ],
    unseen: true,
  };
}

/** A Super Admin: how many people have pending dates (at least one) → the note. */
export function dayLogTeamPendingNote(people: number, now: string): DashNote {
  return {
    key: `${PENDING_NOTE_PREFIX}team:${people}`,
    ts: now,
    tone: 'late',
    text: [
      {
        code: `Day Log — ${people} ${people === 1 ? 'person has' : 'people have'} pending entries`,
        href: '/task-board?view=pending',
      },
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

/**
 * The caller's Pending Entries notes, replies on blank days first — ONE
 * statement. A Super Admin reads everybody's pending dates (they count the
 * people); anyone else only their own. The read returns only blank dates.
 */
export async function readDayLogDayNotes(
  tx: DbTransaction,
  cid: string,
  me: string,
  today: string,
  isSuper: boolean,
): Promise<Array<DashNote & { actorName: string | null }>> {
  const clock = { today, nowMin: 0 };
  const [r] = (await tx.execute(sql`
    SELECT ${pendingColumns(cid, clock, isSuper ? undefined : me)},
      (SELECT COALESCE(json_agg(json_build_object(
                'id', rp.id::text, 'date', to_char(dr.report_date, 'YYYY-MM-DD'),
                'author', COALESCE(au.full_name, au.email), 'body', rp.body,
                'sentAt', rp.sent_at, 'editedAt', rp.edited_at, 'updatedAt', rp.updated_at)
              ORDER BY COALESCE(rp.edited_at, rp.sent_at) DESC), '[]'::json)
       FROM public.daily_report_day_replies rp
       JOIN public.daily_reports dr ON dr.id = rp.daily_report_id AND dr.deleted_at IS NULL
       JOIN public.users au ON au.id = rp.created_by
       WHERE rp.company_id = ${cid}::uuid AND rp.deleted_at IS NULL AND rp.seen_at IS NULL
         AND rp.created_by <> ${me}::uuid
         AND dr.company_id = ${cid}::uuid AND dr.user_id = ${me}::uuid) AS day_replies
  `)) as unknown as Array<Record<string, unknown>>;

  const now = new Date().toISOString();
  const notes: Array<DashNote & { actorName: string | null }> = (
    (r?.['day_replies'] ?? []) as DayLogDayReplyRow[]
  ).map((d) => ({
    ...dayLogDayReplyNote({
      ...d,
      sentAt: iso(d.sentAt),
      editedAt: d.editedAt ? iso(d.editedAt) : null,
      updatedAt: iso(d.updatedAt),
    }),
    actorName: d.author,
  }));
  const pending = pendingOf(r).filter((p) => p.dates.length > 0);
  if (isSuper) {
    if (pending.length > 0) {
      notes.push({ ...dayLogTeamPendingNote(pending.length, now), actorName: null });
    }
  } else if (pending[0]) {
    notes.push({ ...dayLogPendingNote(pending[0].dates, now), actorName: null });
  }
  return notes;
}
