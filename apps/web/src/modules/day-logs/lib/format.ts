// Display helpers for the Day Log screens. Nothing here decides a rule — the
// server's `summary` carries every number the user is judged by; these only
// turn the loaded entries into chips, bar positions and a ticking clock.

import type { DayLogEntry, DayLogStatus, DayLogWorkStatus } from '@innovic/shared';
import {
  DAY_LOG_STATUS_LABELS,
  DAY_LOG_WORK_STATUS_LABELS,
  fmtDuration,
  hhmmToMin,
  minToHhmm,
} from '@innovic/shared';

export const WORK_STATUS_BADGE: Record<DayLogWorkStatus, string> = {
  completed: 'b-green',
  in_progress: 'b-blue',
  blocked: 'b-orange',
};

export const DAY_STATUS_BADGE: Record<DayLogStatus, string> = {
  open: 'b-blue',
  submitted: 'b-green',
  leave: 'b-grey',
};

export function workStatusLabel(e: Pick<DayLogEntry, 'kind' | 'status' | 'toTime'>): string {
  if (e.kind === 'break') return 'Break';
  if (!e.toTime) return 'Running';
  return e.status ? DAY_LOG_WORK_STATUS_LABELS[e.status] : '';
}

export function dayStatusLabel(s: DayLogStatus): string {
  return DAY_LOG_STATUS_LABELS[s];
}

/** "TSK-0042 · Vendor rate comparison" → "TSK-0042". */
export function taskCode(label: string | null): string {
  if (!label) return '';
  return label.split(' · ')[0] ?? label;
}

/** Calendar day ± n, "YYYY-MM-DD" (UTC arithmetic, so no DST/zone drift). */
export function shiftDate(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "Mon 26 Oct 2026". */
export function fmtDayTitle(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return d.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** The server's clock moved on by the time since it answered — display only
 *  (the running timer's elapsed figure, the "To = now" default). */
export function liveNowMin(serverNow: string, fetchedAt: number, nowMs: number): number {
  const drift = Math.max(0, Math.floor((nowMs - fetchedAt) / 60_000));
  return Math.min(24 * 60 - 1, hhmmToMin(serverNow) + drift);
}

export function liveNowHhmm(serverNow: string, fetchedAt: number, nowMs: number): string {
  return minToHhmm(liveNowMin(serverNow, fetchedAt, nowMs));
}

/** Duration column: a running entry shows "running". */
export function entryDuration(e: DayLogEntry): string {
  if (!e.toTime) return 'running';
  if (e.kind === 'break') return fmtDuration(hhmmToMin(e.toTime) - hhmmToMin(e.fromTime));
  return fmtDuration(e.minutes);
}

export interface TimelineSegment {
  key: string;
  kind: 'work' | 'break' | 'running';
  leftPct: number;
  widthPct: number;
  label: string;
  title: string;
}

/** Where each loaded entry sits on the work-window bar. Whatever is not
 *  covered shows the bar's own "missing" background. */
export function timelineSegments(
  entries: readonly DayLogEntry[],
  workFrom: string,
  workTo: string,
  nowMin: number,
): TimelineSegment[] {
  const w1 = hhmmToMin(workFrom);
  const w2 = hhmmToMin(workTo);
  const span = Math.max(1, w2 - w1);
  const out: TimelineSegment[] = [];
  for (const e of entries) {
    const a = hhmmToMin(e.fromTime);
    const b = e.toTime ? hhmmToMin(e.toTime) : Math.max(a, nowMin);
    const from = Math.max(a, w1);
    const to = Math.min(b, w2);
    if (to <= from) continue;
    const kind = e.kind === 'break' ? 'break' : e.toTime ? 'work' : 'running';
    const label = e.kind === 'break' ? e.description : taskCode(e.taskLabel) || e.description;
    out.push({
      key: e.id,
      kind,
      leftPct: ((from - w1) / span) * 100,
      widthPct: ((to - from) / span) * 100,
      label,
      title: `${e.fromTime} – ${e.toTime ?? 'now'} · ${e.description}`,
    });
  }
  return out;
}

/** Whole hours after workFrom up to workTo — the "log up to" buttons. */
export function hourMarks(workFrom: string, workTo: string): string[] {
  const out: string[] = [];
  const first = Math.floor(hhmmToMin(workFrom) / 60) + 1;
  const last = Math.floor(hhmmToMin(workTo) / 60);
  for (let h = first; h <= last; h += 1) out.push(minToHhmm(h * 60));
  return out;
}

/** Error text for an inline notice. */
export function errText(e: unknown, fallback = 'Something went wrong. Try again.'): string {
  return e instanceof Error && e.message ? e.message : fallback;
}
