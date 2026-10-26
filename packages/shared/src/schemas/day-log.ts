// Day Log (owner 2026-10-26) — the user's From–To log of the working day.
// Built on the Daily Task Report tables (daily_reports = the day,
// daily_report_lines = its entries; migration 0222). Rules:
//   - 09:00–18:00 must be covered with no gap; entries go strictly in order —
//     the server, never the browser, decides an entry's From (`nextFrom`).
//   - each user sets their own break times; a break is never logged as work.
//   - Submit locks the day; a Department Admin may Reopen (with a reason),
//     mark a day Leave, or send a reminder. Only the owner writes the log.
// The pure helpers below are shared so the screen shows exactly what the
// server will accept.

import { z } from 'zod';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** "HH:MM", 24-hour. */
export const hhmmSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');

// ── Company rules (one place; D2 / D9 owner decisions) ──────────────────────

export const DAY_LOG_RULES = {
  workFrom: '09:00',
  workTo: '18:00',
  /** Total of a user's breaks inside the work window, minutes. */
  breakLimitMin: 60,
  /** JS getUTCDay() of working days: Mon–Sat. */
  workingWeekdays: [1, 2, 3, 4, 5, 6] as readonly number[],
} as const;

// ── Enums ───────────────────────────────────────────────────────────────────

export const DAY_LOG_STATUSES = ['open', 'submitted', 'leave'] as const;
export type DayLogStatus = (typeof DAY_LOG_STATUSES)[number];
export const DAY_LOG_STATUS_LABELS: Record<DayLogStatus, string> = {
  open: 'Open',
  submitted: 'Submitted',
  leave: 'Leave',
};

export const DAY_LOG_ENTRY_KINDS = ['work', 'break'] as const;
export type DayLogEntryKind = (typeof DAY_LOG_ENTRY_KINDS)[number];

/** Work Status a user may pick (a subset of daily_report_line_status). */
export const DAY_LOG_WORK_STATUSES = ['completed', 'in_progress', 'blocked'] as const;
export type DayLogWorkStatus = (typeof DAY_LOG_WORK_STATUSES)[number];
export const DAY_LOG_WORK_STATUS_LABELS: Record<DayLogWorkStatus, string> = {
  completed: 'Completed',
  in_progress: 'In progress',
  blocked: 'On hold',
};

// ── Time helpers ────────────────────────────────────────────────────────────

export function hhmmToMin(t: string): number {
  const [h, m] = t.split(':');
  return Number(h) * 60 + Number(m);
}

export function minToHhmm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** "2h 05m". */
export function fmtDuration(min: number): string {
  const v = Math.max(0, Math.round(min));
  return `${Math.floor(v / 60)}h ${String(v % 60).padStart(2, '0')}m`;
}

/** Minutes [a1,a2) and [b1,b2) share. */
export function overlapMin(a1: number, a2: number, b1: number, b2: number): number {
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
}

/** Mon–Sat and not a company holiday. */
export function isWorkingDay(date: string, holidays: readonly string[]): boolean {
  const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
  return DAY_LOG_RULES.workingWeekdays.includes(wd) && !holidays.includes(date);
}

export interface DayLogSpan {
  kind: DayLogEntryKind;
  fromTime: string;
  /** null = the timer is running. */
  toTime: string | null;
}

export interface DayLogSummary {
  /** Work minutes needed: window minus breaks inside it. */
  requiredMin: number;
  breakMin: number;
  /** Work minutes logged inside the window. */
  loggedMin: number;
  /** Work minutes logged after workTo. */
  afterMin: number;
  /** requiredMin − loggedMin, never below 0. */
  missingMin: number;
  /** Where the next work entry must start ("HH:MM"). */
  nextFrom: string;
  running: boolean;
}

/**
 * One reading of a day for screen AND server. `nowMin` closes a running
 * entry for the totals only. nextFrom = end of the last entry (or workFrom),
 * pushed past any break it falls into. A Sunday / holiday (`workingDay`
 * false) owes no time: work logged on it still counts, nothing is missing.
 */
export function summarizeDay(
  spans: readonly DayLogSpan[],
  nowMin?: number,
  workingDay = true,
): DayLogSummary {
  const w1 = hhmmToMin(DAY_LOG_RULES.workFrom);
  const w2 = hhmmToMin(DAY_LOG_RULES.workTo);
  const breaks = spans
    .filter((s) => s.kind === 'break' && s.toTime)
    .map((s) => [hhmmToMin(s.fromTime), hhmmToMin(s.toTime as string)] as const)
    .sort((a, b) => a[0] - b[0]);
  const breakMin = breaks.reduce((n, [a, b]) => n + overlapMin(a, b, w1, w2), 0);
  const requiredMin = workingDay ? w2 - w1 - breakMin : 0;

  let loggedMin = 0;
  let afterMin = 0;
  let lastEnd = w1;
  let running = false;
  for (const s of spans) {
    if (s.kind !== 'work') continue;
    const a = hhmmToMin(s.fromTime);
    const b = s.toTime ? hhmmToMin(s.toTime) : Math.max(a, nowMin ?? a);
    if (!s.toTime) running = true;
    loggedMin += overlapMin(a, b, w1, w2);
    afterMin += Math.max(0, b - Math.max(a, w2));
    if (s.toTime) lastEnd = Math.max(lastEnd, b);
  }
  let next = lastEnd;
  for (const [a, b] of breaks) if (next >= a && next < b) next = b;

  return {
    requiredMin,
    breakMin,
    loggedMin,
    afterMin,
    missingMin: Math.max(0, requiredMin - loggedMin),
    nextFrom: minToHhmm(next),
    running,
  };
}

/** First break starting inside (from, to) — an entry may not run over it. */
export function firstBreakInside(
  spans: readonly DayLogSpan[],
  fromMin: number,
  toMin: number,
): DayLogSpan | null {
  let hit: DayLogSpan | null = null;
  for (const s of spans) {
    if (s.kind !== 'break' || !s.toTime) continue;
    const a = hhmmToMin(s.fromTime);
    const b = hhmmToMin(s.toTime);
    if (overlapMin(fromMin, toMin, a, b) > 0 && (!hit || a < hhmmToMin(hit.fromTime))) hit = s;
  }
  return hit;
}

// ── Inputs ──────────────────────────────────────────────────────────────────

const workText = z.string().trim().min(1, 'Write what you did').max(500);

/** "Add time by hand": From is always the server's nextFrom. */
export const addDayLogEntryInputSchema = z.object({
  date: dateStr,
  toTime: hhmmSchema,
  description: workText,
  taskId: z.string().uuid().nullish(),
  status: z.enum(DAY_LOG_WORK_STATUSES).default('completed'),
});
export type AddDayLogEntryInput = z.infer<typeof addDayLogEntryInputSchema>;

export const startDayLogTimerInputSchema = z.object({
  description: workText,
  taskId: z.string().uuid().nullish(),
  /** true = start back at nextFrom, so the unlogged gap becomes this work. */
  includeGap: z.boolean().default(false),
});
export type StartDayLogTimerInput = z.infer<typeof startDayLogTimerInputSchema>;

export const stopDayLogTimerInputSchema = z.object({
  status: z.enum(DAY_LOG_WORK_STATUSES),
  /** Required only when the timer was left running on an earlier day. */
  endTime: hhmmSchema.optional(),
});
export type StopDayLogTimerInput = z.infer<typeof stopDayLogTimerInputSchema>;

export const setDayLogEntryStatusInputSchema = z.object({
  status: z.enum(DAY_LOG_WORK_STATUSES),
  /** §20.4 — the entry's updatedAt as loaded. */
  updatedAt: z.string(),
});
export type SetDayLogEntryStatusInput = z.infer<typeof setDayLogEntryStatusInputSchema>;

export const dayLogDateInputSchema = z.object({ date: dateStr });
export type DayLogDateInput = z.infer<typeof dayLogDateInputSchema>;

/** Department Admin actions on someone else's day. */
export const dayLogUserDayInputSchema = z.object({ userId: z.string().uuid(), date: dateStr });
export type DayLogUserDayInput = z.infer<typeof dayLogUserDayInputSchema>;

export const dayLogReasonInputSchema = dayLogUserDayInputSchema.extend({
  reason: z.string().trim().min(3, 'Give a reason').max(500),
});
export type DayLogReasonInput = z.infer<typeof dayLogReasonInputSchema>;

export const userBreakTimeInputSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    fromTime: hhmmSchema,
    toTime: hhmmSchema,
  })
  .refine((b) => hhmmToMin(b.toTime) > hhmmToMin(b.fromTime), {
    message: 'To must be after From',
    path: ['toTime'],
  });

export const saveMyBreaksInputSchema = z.object({
  breaks: z.array(userBreakTimeInputSchema).max(6),
});
export type SaveMyBreaksInput = z.infer<typeof saveMyBreaksInputSchema>;

export const holidayInputSchema = z.object({
  date: dateStr,
  name: z.string().trim().min(1).max(100),
});
export type HolidayInput = z.infer<typeof holidayInputSchema>;

export const dayLogQuerySchema = z.object({
  date: dateStr.optional(),
  /** Someone else's day (Department Admin / Super Admin / Auditor). */
  userId: z.string().uuid().optional(),
});
export type DayLogQuery = z.infer<typeof dayLogQuerySchema>;

export const teamDayLogQuerySchema = z.object({ date: dateStr.optional() });
export type TeamDayLogQuery = z.infer<typeof teamDayLogQuerySchema>;

// ── Responses ───────────────────────────────────────────────────────────────

export const dayLogEntrySchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(DAY_LOG_ENTRY_KINDS),
  fromTime: z.string(),
  toTime: z.string().nullable(),
  /** Work minutes (server-computed; 0 while running). */
  minutes: z.number().int(),
  description: z.string(),
  taskId: z.string().uuid().nullable(),
  /** "TSK-0042 · Vendor rate comparison" */
  taskLabel: z.string().nullable(),
  status: z.enum(DAY_LOG_WORK_STATUSES).nullable(),
  stopNote: z.string().nullable(),
  updatedAt: z.string(),
});
export type DayLogEntry = z.infer<typeof dayLogEntrySchema>;

export const userBreakTimeSchema = z.object({
  name: z.string(),
  fromTime: z.string(),
  toTime: z.string(),
});
export type UserBreakTime = z.infer<typeof userBreakTimeSchema>;

export const dayLogSummarySchema = z.object({
  requiredMin: z.number().int(),
  breakMin: z.number().int(),
  loggedMin: z.number().int(),
  afterMin: z.number().int(),
  missingMin: z.number().int(),
  nextFrom: z.string(),
  running: z.boolean(),
});

export const dayLogDetailSchema = z.object({
  /** null until the first entry is saved. */
  id: z.string().uuid().nullable(),
  userId: z.string().uuid(),
  userName: z.string(),
  deptLabel: z.string().nullable(),
  date: z.string(),
  /** Server's IST today and now — the screen's clock. */
  today: z.string(),
  nowTime: z.string(),
  status: z.enum(DAY_LOG_STATUSES),
  workingDay: z.boolean(),
  holidayName: z.string().nullable(),
  workFrom: z.string(),
  workTo: z.string(),
  entries: z.array(dayLogEntrySchema),
  summary: dayLogSummarySchema,
  submittedAt: z.string().nullable(),
  submittedByName: z.string().nullable(),
  leaveReason: z.string().nullable(),
  reopenedAt: z.string().nullable(),
  reopenedByName: z.string().nullable(),
  reopenReason: z.string().nullable(),
  /** An earlier working day still open (D3): today is locked until it is done. */
  blockedBy: z.object({ date: z.string(), reason: z.string() }).nullable(),
  /** Timer left running on another day: must be stopped with an end time first. */
  strayTimer: z
    .object({ date: z.string(), entryId: z.string().uuid(), fromTime: z.string() })
    .nullable(),
  isOwner: z.boolean(),
  /** Owner may add / stop / remove / submit right now. */
  canWrite: z.boolean(),
  /** Viewer may Reopen / mark Leave / remind (Department Admin, Super Admin). */
  canManage: z.boolean(),
});
export type DayLogDetail = z.infer<typeof dayLogDetailSchema>;

export const teamDayLogRowSchema = z.object({
  userId: z.string().uuid(),
  userName: z.string(),
  deptLabel: z.string().nullable(),
  /** "L1 Viewer" etc. in the viewer's department; null for Super Admin view. */
  tierLabel: z.string().nullable(),
  dayLogId: z.string().uuid().nullable(),
  status: z.enum(DAY_LOG_STATUSES),
  loggedMin: z.number().int(),
  requiredMin: z.number().int(),
  missingMin: z.number().int(),
  /** First unlogged slot, "14:00 – 18:00", or null. */
  missingFrom: z.string().nullable(),
  /** "GRN entry since 14:10" — the running timer, if any. */
  runningNow: z.string().nullable(),
  submittedAt: z.string().nullable(),
});
export type TeamDayLogRow = z.infer<typeof teamDayLogRowSchema>;

export const teamDayLogResponseSchema = z.object({
  date: z.string(),
  today: z.string(),
  workingDay: z.boolean(),
  rows: z.array(teamDayLogRowSchema),
  canManage: z.boolean(),
});
export type TeamDayLogResponse = z.infer<typeof teamDayLogResponseSchema>;

export const myBreaksResponseSchema = z.object({
  breaks: z.array(userBreakTimeSchema),
  breakLimitMin: z.number().int(),
});
export type MyBreaksResponse = z.infer<typeof myBreaksResponseSchema>;

export const holidaySchema = z.object({
  id: z.string().uuid(),
  date: z.string(),
  name: z.string(),
});
export type Holiday = z.infer<typeof holidaySchema>;

/** Who may open the Team Day Logs tab (drives the tab itself, §20.5). */
export const dayLogAccessSchema = z.object({
  canSeeTeam: z.boolean(),
  canManageHolidays: z.boolean(),
});
export type DayLogAccess = z.infer<typeof dayLogAccessSchema>;

/** Link picker: the viewer's own open tasks / to-dos (TSK- / TODO-). */
export const dayLogTaskOptionsQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
});
export const dayLogTaskOptionSchema = z.object({
  id: z.string().uuid(),
  /** "TSK-0042 · Vendor rate comparison" */
  label: z.string(),
});
export type DayLogTaskOption = z.infer<typeof dayLogTaskOptionSchema>;
