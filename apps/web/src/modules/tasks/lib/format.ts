// Task Board display helpers — date formats (thin wrappers over the one web
// display format in lib/date.ts: DD-MMM-YYYY, date + time as DD-MMM-YYYY HH:mm
// IST), the priority / status colour ladders, and the Related-To → page map.

import type { TaskPriority, TaskRelatedType, TaskRow, TaskStatus } from '@innovic/shared';
import { TASK_STATUS_LABELS } from '@innovic/shared';
import { fmtDate, fmtDateTime } from '@/lib/date';

/** `2026-09-22` → `22-Sep-2026`; null/blank → `—`. */
export function fmtTaskDate(d: string | null | undefined): string {
  return fmtDate(d);
}

/** ISO timestamp → `21-Sep-2026 16:10` IST (the "Last Update" column). */
export function fmtTaskDateTime(iso: string | null | undefined): string {
  return fmtDateTime(iso);
}

/** ISO timestamp → `21-Sep-2026 16:10` IST (detail facts + timeline). */
export function fmtTaskDateTimeFull(iso: string | null | undefined): string {
  return fmtDateTime(iso);
}

/** A `datetime-local` value (`2026-09-22T09:30`) → ISO with the browser's
 *  offset (`2026-09-22T09:30:00+05:30`), the shape the reminder field wants. */
export function localDateTimeToIso(local: string): string | undefined {
  if (!local) return undefined;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return undefined;
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const pad = (n: number): string => String(Math.abs(n)).padStart(2, '0');
  const hh = pad(Math.trunc(off / 60));
  const mm = pad(off % 60);
  const yyyy = d.getFullYear();
  return `${yyyy}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00${sign}${hh}:${mm}`;
}

/** ISO → the `datetime-local` value for an edit form (browser-local). */
export function isoToLocalDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Priority text colour: Urgent / High red, Normal amber, Low muted. */
export function priorityColor(p: TaskPriority): string {
  if (p === 'urgent' || p === 'high') return 'var(--red)';
  if (p === 'medium') return 'var(--amber2)';
  return 'var(--text3)';
}

/** THE one status colour map (strip, badge, widget). To Do waits = grey,
 *  In Progress under way = amber, Completed green, Cancelled grey, Overdue red.
 *  `cls` is the badge class; `color` is the matching token for a strip tile. */
export const TASK_STATUS_TONE: Record<TaskStatus | 'overdue', { cls: string; color: string }> = {
  todo: { cls: 'badge b-grey', color: 'var(--text2)' },
  in_progress: { cls: 'badge b-amber', color: 'var(--amber2)' },
  completed: { cls: 'badge b-green', color: 'var(--green2)' },
  cancelled: { cls: 'badge b-grey', color: 'var(--text2)' },
  overdue: { cls: 'badge b-red', color: 'var(--red2)' },
};

/** Status pill — the badge class + label. Overdue is derived, never stored,
 *  so an open task past its date shows Overdue while its status stays. */
export function statusPill(t: Pick<TaskRow, 'status' | 'isOverdue'>): {
  cls: string;
  label: string;
} {
  if (t.status === 'completed') return { cls: TASK_STATUS_TONE.completed.cls, label: 'Completed' };
  if (t.status === 'cancelled') return { cls: TASK_STATUS_TONE.cancelled.cls, label: 'Cancelled' };
  if (t.isOverdue) return { cls: TASK_STATUS_TONE.overdue.cls, label: 'Overdue' };
  const s = t.status as TaskStatus;
  return { cls: TASK_STATUS_TONE[s].cls, label: TASK_STATUS_LABELS[s] };
}

export function isOpenTask(t: Pick<TaskRow, 'status'>): boolean {
  return t.status === 'todo' || t.status === 'in_progress';
}

/** Where a picked Reference No. navigates. Stored on the task as
 *  `linkedRef.navPage` so the row / detail link works without a lookup. */
export function relatedNavPage(type: TaskRelatedType, id: string): string {
  switch (type) {
    case 'sales_order':
      return `/sales-orders/${id}`;
    case 'job_card':
      return `/job-cards/${id}`;
    case 'purchase_order':
      return `/purchase-orders/${id}`;
    case 'nc':
      return `/nc-register/${id}`;
    case 'design_project':
      return `/design-projects/${id}`;
    case 'qc_call':
      return `/qc-call-register?op=${id}`;
  }
}

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Reject any file over 10 MB; returns the first offender's name or null. */
export function oversizedFile(files: File[]): string | null {
  const bad = files.find((f) => f.size > MAX_ATTACHMENT_BYTES);
  return bad ? bad.name : null;
}
