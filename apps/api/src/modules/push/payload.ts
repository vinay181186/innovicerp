// ADR-309 — the pure parts of the task pop-up: the words, the link, the VAPID
// switch and the per-row decision. No env / database / web-push imports, so
// the unit tests load this file alone. The bell (dashboard/personal/
// task-notes.ts) uses the same href so a click lands in the same place.

import {
  type DesktopPopups,
  PUSH_MAX_AGE_HOURS,
  type PushConfigResponse,
  TASK_PRIORITY_LABELS,
  type TaskNoticeKind,
  type TaskPriority,
  type TaskPushPayload,
  taskPushPayloadSchema,
} from '@innovic/shared';
import { AuthorizationError } from '../../lib/errors';

/** Where a click on a task notice lands. Assigned / cancelled → the
 *  assignee's Inbox. Completed → the Outbox only for the task's creator (the
 *  Outbox lists created_by = me); anyone else (an assigner who did not create
 *  it) gets the board with just ?task, which opens the task's detail on any
 *  tab. One function for the pop-up AND the bell (task-notes.ts). */
export function taskNoticeHref(
  kind: TaskNoticeKind,
  taskId: string,
  recipientIsCreator: boolean,
): string {
  const task = encodeURIComponent(taskId);
  if (kind !== 'task_completed') return `/task-board?view=inbox&task=${task}`;
  return recipientIsCreator ? `/task-board?view=outbox&task=${task}` : `/task-board?task=${task}`;
}

/** "Rakesh Patel" → "RP". Null when there is no name. */
export function initialsOf(name: string | null): string | null {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const first = parts[0]!.charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1]!.charAt(0) : '';
  return (first + last).toUpperCase().slice(0, 4);
}

/** 2026-11-18 → 18-11-2026 (owner date format). */
export function ddmmyyyy(day: string | null): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day ?? '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

const clip = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);

export interface TaskNoticeRow {
  noticeId: string;
  kind: TaskNoticeKind;
  taskId: string;
  /** The recipient is the task's creator (decides the completed link). */
  recipientIsCreator: boolean;
  code: string;
  title: string;
  dueDate: string | null;
  priority: TaskPriority | null;
  actorName: string | null;
  completionRemark: string | null;
}

/** The pop-up the service worker shows for one notice. */
export function buildTaskPushPayload(r: TaskNoticeRow): TaskPushPayload {
  const actor = r.actorName?.trim() || 'Someone';
  let title: string;
  let body: string;
  if (r.kind === 'task_assigned') {
    title = `New task for you · ${r.code}`;
    const due = ddmmyyyy(r.dueDate);
    const tail = [
      `From ${actor}`,
      ...(due ? [`Due ${due}`] : []),
      ...(r.priority ? [TASK_PRIORITY_LABELS[r.priority]] : []),
    ].join(' · ');
    body = `${r.title}\n${tail}`;
  } else if (r.kind === 'task_completed') {
    title = `Task completed · ${r.code}`;
    const remark = r.completionRemark?.trim();
    body = `${actor} completed "${r.title}"${remark ? `\nRemark: ${remark}` : ''}`;
  } else {
    title = `Task cancelled · ${r.code}`;
    body = `${actor} cancelled "${r.title}"`;
  }
  return taskPushPayloadSchema.parse({
    noticeId: r.noticeId,
    kind: r.kind,
    title: clip(title, 120),
    body: clip(body, 300),
    href: clip(taskNoticeHref(r.kind, r.taskId, r.recipientIsCreator), 300),
    actorInitials: initialsOf(r.actorName),
  });
}

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/** The VAPID keys, or null when any is missing (pop-ups switched off). */
export function vapidFrom(e: {
  VAPID_PUBLIC_KEY?: string | undefined;
  VAPID_PRIVATE_KEY?: string | undefined;
  VAPID_SUBJECT?: string | undefined;
}): VapidConfig | null {
  const publicKey = e.VAPID_PUBLIC_KEY?.trim();
  const privateKey = e.VAPID_PRIVATE_KEY?.trim();
  const subject = e.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

export type PushDecision = 'send' | 'off' | 'failed';

/** What the sender does with one claimed pending notice: no server keys or
 *  no switched-on browser → 'off'; older than PUSH_MAX_AGE_HOURS → 'failed'
 *  (no stale pop-ups); else send. */
export function pushDecision(
  eventAt: Date,
  opts: { vapidOn: boolean; hasSubscription: boolean; now: Date },
): PushDecision {
  if (!opts.vapidOn) return 'off';
  if (opts.now.getTime() - eventAt.getTime() > PUSH_MAX_AGE_HOURS * 3_600_000) return 'failed';
  if (!opts.hasSubscription) return 'off';
  return 'send';
}

/** ADR-314 — the caller's Desktop Pop-ups switch. 'disabled' = this person
 *  gets no pop-up on any laptop: the config says off (the web hides the band
 *  and the bell switch), subscribe / test are refused. Bell notes are kept. */
export const DESKTOP_POPUPS_DISABLED_MESSAGE = 'Desktop pop-ups are disabled for your login.';

export function pushConfigFor(
  desktopPopups: DesktopPopups | null,
  keys: Pick<VapidConfig, 'publicKey'> | null,
): PushConfigResponse {
  if (desktopPopups === 'disabled' || !keys) return { enabled: false, publicKey: null };
  return { enabled: true, publicKey: keys.publicKey };
}

/** ADR-314 — subscribe / test refusal: 403 for a disabled login. */
export function assertDesktopPopupsAllowed(desktopPopups: DesktopPopups | null): void {
  if (desktopPopups === 'disabled') throw new AuthorizationError(DESKTOP_POPUPS_DISABLED_MESSAGE);
}
