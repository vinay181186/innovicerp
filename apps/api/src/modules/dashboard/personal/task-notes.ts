// ADR-309 (owner 2026-11-18) — task notices in the bell. One task_notices row
// (tasks/notices.ts, the one writer) per person per task event; the same row
// drives the Windows pop-up (push/sender.ts), so bell and pop-up agree.
// Personal: only the caller's OWN notices — a Super Admin / Full Access does
// NOT see other people's (owner rule 1 widens next-step notes, not someone
// else's private task mail). Read in the window, newest first, bounded.
// open = false: these are past facts; the home block (open-only) is unchanged
// and the bell (history) shows them.

import type { TaskNoticeKind } from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
import { taskNoticeHref } from '../../push/payload';
import type { ExtraNote, NoteSource } from './note-sources';
import { codePart } from './util';

const TASK_NOTE_SCAN = 200;

export interface TaskNoteRow {
  id: string;
  kind: TaskNoticeKind;
  taskId: string;
  /** The caller created the task (decides the completed link, ADR-309). */
  recipientIsCreator: boolean;
  code: string;
  title: string;
  actor: string;
  ts: string;
}

const VERB: Record<TaskNoticeKind, string> = {
  task_assigned: 'assigned you',
  task_completed: 'completed',
  task_cancelled: 'cancelled',
};
const TONE: Record<TaskNoticeKind, ExtraNote['tone']> = {
  task_assigned: 'due',
  task_completed: 'ok',
  task_cancelled: 'late',
};

/** The caller's note for one task notice. Pure. */
export function taskNote(r: TaskNoteRow): ExtraNote {
  return {
    key: `task:${r.id}`,
    ts: r.ts,
    tone: TONE[r.kind],
    actorName: r.actor,
    open: false,
    unseen: false,
    text: [
      { text: `${r.actor} ${VERB[r.kind]} ` },
      codePart(r.code, taskNoticeHref(r.kind, r.taskId, r.recipientIsCreator)),
      ...(r.title ? [{ text: ` · ${r.title}` }] : []),
    ],
  };
}

const iso = (v: unknown): string => (v instanceof Date ? v : new Date(String(v))).toISOString();

/** The caller's task-notice source (read with readSources). */
export function taskSources(cid: string, me: string, since: SQL): NoteSource[] {
  return [
    {
      source: 'task:notices',
      query: sql`SELECT n.id::text AS id, n.kind, n.task_id::text AS task_id, t.code, t.title,
          (t.created_by = n.recipient_id) AS recipient_is_creator,
          COALESCE(NULLIF(btrim(u.full_name), ''), u.email, 'Someone') AS actor,
          n.event_at AS ts
        FROM public.task_notices n
        JOIN public.tasks t ON t.id = n.task_id AND t.company_id = n.company_id
        LEFT JOIN public.users u ON u.id = n.actor_id
        WHERE n.company_id = ${cid}::uuid AND n.recipient_id = ${me}::uuid
          AND n.deleted_at IS NULL AND t.deleted_at IS NULL AND n.event_at >= ${since}
        ORDER BY n.event_at DESC, n.id DESC LIMIT ${TASK_NOTE_SCAN}`,
      orderCol: 'ts',
      toNotes: (rows) =>
        rows.map((r) =>
          taskNote({
            id: String(r['id']),
            kind: String(r['kind']) as TaskNoticeKind,
            taskId: String(r['task_id']),
            recipientIsCreator: r['recipient_is_creator'] === true,
            code: String(r['code'] ?? ''),
            title: String(r['title'] ?? ''),
            actor: String(r['actor'] ?? 'Someone'),
            ts: iso(r['ts']),
          }),
        ),
    },
  ];
}
