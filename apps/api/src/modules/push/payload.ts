// ADR-309 — the pure parts of the task pop-up: the words, the link, the VAPID
// switch and the per-row decision. No env / database / web-push imports, so
// the unit tests load this file alone. The bell (dashboard/personal/
// task-notes.ts) uses the same href so a click lands in the same place.

import {
  PUSH_MAX_AGE_HOURS,
  TASK_PRIORITY_LABELS,
  type TaskNoticeKind,
  type TaskPriority,
  type TaskPushPayload,
  taskPushPayloadSchema,
} from '@innovic/shared';

/** Where a click on a task notice lands: the assignee's Inbox for assigned /
 *  cancelled, the assigner's Outbox for completed. */
export function taskNoticeHref(kind: TaskNoticeKind, taskId: string): string {
  const view = kind === 'task_completed' ? 'outbox' : 'inbox';
  return `/task-board?view=${view}&task=${encodeURIComponent(taskId)}`;
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
    href: clip(taskNoticeHref(r.kind, r.taskId), 300),
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
