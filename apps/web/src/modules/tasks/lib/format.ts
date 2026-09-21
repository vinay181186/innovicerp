// Task Board display helpers — date formats the approved board uses
// (dd-MMM-yyyy for dates, dd-MMM HH:mm IST for "Last Update"), the
// priority / status colour ladders, and the Related-To → page map.
// lib/date.ts has no dd-MMM formatter (it only deals in YYYY-MM-DD), so the
// two formatters live here, scoped to this module.

import type { TaskPriority, TaskRelatedType, TaskRow, TaskStatus } from '@innovic/shared';
import { TASK_STATUS_LABELS } from '@innovic/shared';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-09-22` → `22-Sep-2026`. Anything that is not a plain calendar date
 *  is returned as-is; null/blank → `—`. */
export function fmtTaskDate(d: string | null | undefined): string {
  if (!d) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  if (!m?.[1] || !m[2] || !m[3]) return d;
  const mon = MONTHS[Number(m[2]) - 1];
  return mon ? `${m[3]}-${mon}-${m[1]}` : d;
}

/** ISO timestamp → `21-Sep 16:10` in IST (the "Last Update" column). */
export function fmtTaskDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}-${get('month')} ${get('hour')}:${get('minute')}`;
}

/** ISO timestamp → `21-Sep-2026 16:10` IST (detail facts + timeline). */
export function fmtTaskDateTimeFull(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}-${get('month')}-${get('year')} ${get('hour')}:${get('minute')}`;
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

/** Status pill — the badge class + label. Overdue is derived, never stored,
 *  so an open task past its date shows OVERDUE while its status stays. */
export function statusPill(t: Pick<TaskRow, 'status' | 'isOverdue'>): {
  cls: string;
  label: string;
} {
  if (t.status === 'completed') return { cls: 'badge b-green', label: 'Completed' };
  if (t.status === 'cancelled') return { cls: 'badge b-grey', label: 'Cancelled' };
  if (t.isOverdue) return { cls: 'badge b-red', label: 'Overdue' };
  if (t.status === 'in_progress') return { cls: 'badge b-amber', label: 'In Progress' };
  return { cls: 'badge b-blue', label: TASK_STATUS_LABELS[t.status as TaskStatus] };
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
