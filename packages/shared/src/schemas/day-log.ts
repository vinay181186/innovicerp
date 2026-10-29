// Day Log — SIMPLE SHEET (owner 2026-10-27, final). Built on daily_reports /
// daily_report_lines (0222–0225). Rules:
//   - A row is Start · Stop · SO / JWSO (optional) · Working on. Start AND
//     Stop are compulsory (typed or picked, AM/PM); Working on is free text
//     (work, lunch, meeting, leave — whatever the user wants to mention). No
//     Type, Remark, Open/Closed, ■ Stop, Break, Others or Submit Day.
//   - Rows never overlap and never end after now. Many new rows save at once.
//   - A SAVED row is never removed. ✎ an edit → it goes for APPROVAL: the row
//     keeps its values and shows "Edit pending" until a Department Admin
//     (L5 of a dept where the person holds L2+) or a Super Admin approves
//     (new values apply) or rejects (reason shown). Never one's own.
//   - A day can be written only when the PREVIOUS CALENDAR DAY has at least
//     one saved row (no skipping Sundays / holidays — the user types
//     "Sunday" / "Holiday"); a person's very first day is not locked.
//   - LATE (saved > lateAfterMin after its Stop) is shown to admins only.
// Older fields (kind, remarks, statuses, Others) stay in the contract for old
// rows but the screens no longer use them. The pure helpers below are shared
// so the screen shows exactly what the server will accept.

import { z } from 'zod';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** "HH:MM", 24-hour. */
export const hhmmSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');

// ── Company rules (one place) ───────────────────────────────────────────────

export const DAY_LOG_RULES = {
  workFrom: '09:00',
  workTo: '18:00',
  /** Total break minutes a day. */
  breakLimitMin: 60,
  /** An entry saved more than this many minutes after its Stop time is LATE. */
  lateAfterMin: 60,
  /** Longest From–To range on the person page, days. */
  maxRangeDays: 62,
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

export const DAY_LOG_ENTRY_KINDS = ['work', 'break', 'leave'] as const;
export type DayLogEntryKind = (typeof DAY_LOG_ENTRY_KINDS)[number];
export const DAY_LOG_ENTRY_KIND_LABELS: Record<DayLogEntryKind, string> = {
  work: 'Work',
  break: 'Break',
  leave: 'Others',
};

/** The reason an Others entry is for — stored as its description. */
export const DAY_LOG_OTHERS_REASONS = [
  'Late coming',
  'Half day',
  'Full day',
  'Permission',
  'Personal',
] as const;
export type DayLogOthersReason = (typeof DAY_LOG_OTHERS_REASONS)[number];
export const DAY_LOG_LATE_COMING = 'Late coming' satisfies DayLogOthersReason;

export const DAY_LOG_ORDER_TYPES = ['so', 'jwso'] as const;
export type DayLogOrderType = (typeof DAY_LOG_ORDER_TYPES)[number];

/** Team Day Logs "Now": working = a work entry is Open; break = a break
 *  entry is Open; idle = entries today, nothing Open; not_started = no
 *  entries today. A past day shows its day status instead. */
export const DAY_LOG_CURRENT_STATUSES = [
  'working',
  'break',
  'idle',
  'not_started',
  'submitted',
  'leave',
] as const;
export type DayLogCurrentStatus = (typeof DAY_LOG_CURRENT_STATUSES)[number];
export const DAY_LOG_CURRENT_STATUS_LABELS: Record<DayLogCurrentStatus, string> = {
  working: 'Working',
  break: 'On break',
  idle: 'Idle',
  not_started: 'Not started',
  submitted: 'Submitted',
  leave: 'Others',
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

/** "09:00 AM" / "03:15 PM" — how every Day Log time is shown. */
export function fmt12(hhmm: string | null | undefined): string {
  if (!hhmm) return '—';
  const [hs, ms] = hhmm.split(':');
  const h = Number(hs);
  const ap = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, '0')}:${ms} ${ap}`;
}

/**
 * A typed time → 24-hour "HH:MM", or null. Accepts "930", "9:30", "09.30",
 * "9", "3pm", "3:15 pm", "03:15 PM", "1530". Without AM/PM a 24-hour reading
 * is used, except an unpadded 1–6 which means the afternoon ("3" = 03:00 PM).
 */
export function parseTime(raw: string): string | null {
  const t = raw.trim().toLowerCase().replace(/\s+/g, '');
  const m = /^(\d{1,2})(?:[:.]?(\d{2}))?(am|pm|a|p)?$/.exec(t);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = m[3]?.[0];
  if (min > 59) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (ap === 'a' && h === 12) h = 0;
    if (ap === 'p' && h !== 12) h += 12;
  } else {
    if (h > 23) return null;
    // "3" / "330" = afternoon; a zero-padded "06:30" / "0630" is read as typed.
    if (h >= 1 && h <= 6 && !m[1]!.startsWith('0')) h += 12;
  }
  return minToHhmm(h * 60 + min);
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
  /** null = the entry is Open. */
  toTime: string | null;
}

export interface DayLogSummary {
  workMin: number;
  breakMin: number;
  /** Leave / permission minutes (covers time, not work). */
  leaveMin: number;
  /** Earliest Start ("HH:MM"), null when no entries. */
  firstStart: string | null;
  /** Latest Stop, or now for an Open entry; null when no entries. */
  lastStop: string | null;
  /** Minutes of 09:00–18:00 (up to `nowMin` when given) that no entry covers.
   *  0 on a non-working day. Submit Day needs it 0 for the whole window. */
  unloggedMin: number;
  /** An entry is Open. */
  open: boolean;
  /** Work entries. */
  entryCount: number;
  /** Where the next entry must start (strict order): the last entry's Stop,
   *  09:00 when the day is empty; null while an entry is Open. */
  nextStart: string | null;
}

/**
 * One reading of a day for screen AND server. `nowMin` closes an Open entry
 * at now for the totals and limits the unlogged check to now (today); leave
 * it out to judge the whole window (Submit).
 */
export function summarizeDay(
  spans: readonly DayLogSpan[],
  nowMin?: number,
  workingDay = true,
): DayLogSummary {
  const w1 = hhmmToMin(DAY_LOG_RULES.workFrom);
  const w2 = hhmmToMin(DAY_LOG_RULES.workTo);
  const ivals = spans
    .map((s) => {
      const a = hhmmToMin(s.fromTime);
      const b = s.toTime ? hhmmToMin(s.toTime) : Math.max(a, nowMin ?? a);
      return { kind: s.kind, a, b, open: !s.toTime };
    })
    .sort((x, y) => x.a - y.a);
  let workMin = 0;
  let breakMin = 0;
  let leaveMin = 0;
  const present = ivals.filter((i) => i.kind !== 'leave');
  for (const i of ivals) {
    if (i.kind === 'work') workMin += i.b - i.a;
    else if (i.kind === 'break') breakMin += i.b - i.a;
    else leaveMin += i.b - i.a;
  }
  const end = Math.min(w2, nowMin ?? w2);
  let covered = w1;
  let unloggedMin = 0;
  for (const i of ivals) {
    if (i.a > covered && covered < end) unloggedMin += Math.min(i.a, end) - covered;
    covered = Math.max(covered, i.b);
  }
  if (covered < end) unloggedMin += end - covered;
  return {
    workMin,
    breakMin,
    leaveMin,
    // First start / Last stop say when the person was in — a Leave is not.
    firstStart: present.length ? minToHhmm(Math.min(...present.map((i) => i.a))) : null,
    lastStop: present.length ? minToHhmm(Math.max(...present.map((i) => i.b))) : null,
    unloggedMin: workingDay ? Math.max(0, unloggedMin) : 0,
    open: ivals.some((i) => i.open),
    entryCount: ivals.filter((i) => i.kind === 'work').length,
    nextStart: ivals.some((i) => i.open)
      ? null
      : ivals.length
        ? minToHhmm(Math.max(...ivals.map((i) => i.b)))
        : DAY_LOG_RULES.workFrom,
  };
}

// ── Inputs ──────────────────────────────────────────────────────────────────

const entryFields = {
  /** Always 'work' now (kept for old rows). */
  kind: z.enum(DAY_LOG_ENTRY_KINDS).default('work'),
  /** Working on — compulsory, free text. */
  description: z.string().trim().max(2000).default(''),
  startTime: hhmmSchema,
  /** Compulsory. */
  stopTime: hhmmSchema,
  /** Work only: the SO or JWSO it was for. */
  orderType: z.enum(DAY_LOG_ORDER_TYPES).nullish(),
  orderId: z.string().uuid().nullish(),
  remarks: z.string().trim().max(2000).nullish(),
};

function entryRules<T extends z.ZodTypeAny>(schema: T): T {
  return schema
    .refine((v: { description: string }) => v.description.length > 0, {
      message: 'Write what you worked on',
      path: ['description'],
    })
    .refine(
      (v: { startTime: string; stopTime: string }) =>
        hhmmToMin(v.stopTime) > hhmmToMin(v.startTime),
      { message: 'Stop time must be after Start time', path: ['stopTime'] },
    )
    .refine(
      (v: { orderType?: string | null; orderId?: string | null }) => !v.orderType === !v.orderId,
      { message: 'Pick the SO / JWSO again', path: ['orderId'] },
    ) as unknown as T;
}

export const addDayLogEntryInputSchema = entryRules(z.object({ date: dateStr, ...entryFields }));
export type AddDayLogEntryInput = z.infer<typeof addDayLogEntryInputSchema>;

export const updateDayLogEntryInputSchema = entryRules(
  z.object({
    ...entryFields,
    /** §20.4 — the entry's updatedAt as loaded. A Start / Stop / SO edit of
     *  a SAVED row is not applied: it is staged for approval (pending).
     *  ADR-255: `description` is IGNORED here (the screen sends the current
     *  text) — Working On changes only through updateDayLogWorkInputSchema. */
    updatedAt: z.string(),
  }),
);
export type UpdateDayLogEntryInput = z.infer<typeof updateDayLogEntryInputSchema>;

/** One new row of the sheet: Start, Stop and Working on compulsory. */
const sheetRowSchema = entryRules(
  z.object({
    startTime: entryFields.startTime,
    stopTime: entryFields.stopTime,
    description: entryFields.description,
    orderType: entryFields.orderType,
    orderId: entryFields.orderId,
  }),
);
export type DayLogSheetRow = z.infer<typeof sheetRowSchema>;

/** Save several new rows at once — all or nothing. */
export const addDayLogEntriesInputSchema = z.object({
  date: dateStr,
  rows: z.array(sheetRowSchema).min(1).max(40),
});
export type AddDayLogEntriesInput = z.infer<typeof addDayLogEntriesInputSchema>;

/** ■ Stop an Open entry: the remark is compulsory (kept if it has one). */
export const stopDayLogEntryInputSchema = z.object({
  remarks: z.string().trim().max(2000).nullish(),
});
export type StopDayLogEntryInput = z.infer<typeof stopDayLogEntryInputSchema>;

export const dayLogDateInputSchema = z.object({ date: dateStr });
export type DayLogDateInput = z.infer<typeof dayLogDateInputSchema>;

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

export const dayLogOrderOptionsQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
});
export type DayLogOrderOptionsQuery = z.infer<typeof dayLogOrderOptionsQuerySchema>;

// ── Responses ───────────────────────────────────────────────────────────────

export const dayLogOrderSchema = z.object({
  type: z.enum(DAY_LOG_ORDER_TYPES),
  id: z.string().uuid(),
  /** IN-SO-00012 / IN-JW-00005 */
  code: z.string(),
});
export type DayLogOrder = z.infer<typeof dayLogOrderSchema>;

export const dayLogOrderOptionSchema = dayLogOrderSchema.extend({
  /** The typed SO-xxxx / JW-xxx number, if any. */
  ref: z.string().nullable(),
  party: z.string().nullable(),
});
export type DayLogOrderOption = z.infer<typeof dayLogOrderOptionSchema>;

/** ADR-255 — a Super Admin reply as the entry's OWNER sees it (My Day Log).
 *  No revision fact ever travels to the owner. day-log-text.ts builds the
 *  Super Admin's view of a reply on top of this. */
export const dayLogOwnReplySchema = z.object({
  id: z.string().uuid(),
  body: z.string(),
  authorName: z.string(),
  sentAt: z.string(),
  /** null = never edited. */
  editedAt: z.string().nullable(),
  /** Not opened since it was sent / last edited — drives the row's 🔔. */
  unread: z.boolean(),
});
export type DayLogOwnReply = z.infer<typeof dayLogOwnReplySchema>;

export const dayLogEntrySchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(DAY_LOG_ENTRY_KINDS),
  fromTime: z.string(),
  /** null = Open. */
  toTime: z.string().nullable(),
  /** Server-computed; an Open entry counts to now (today). */
  minutes: z.number().int(),
  description: z.string(),
  order: dayLogOrderSchema.nullable(),
  remarks: z.string().nullable(),
  late: z.boolean(),
  updatedAt: z.string(),
  /** ADR-255 — Super Admin replies, oldest first (owner's view). */
  replies: z.array(dayLogOwnReplySchema),
  /** An edit of Start / Stop / SO waiting for approval (the row still shows
   *  its old values). Working On is edited directly (ADR-255), never here. */
  pending: z
    .object({
      fromTime: z.string(),
      toTime: z.string(),
      description: z.string(),
      order: dayLogOrderSchema.nullable(),
      requestedAt: z.string(),
    })
    .nullable(),
  /** The last edit was rejected: why (cleared by the next edit). */
  rejectReason: z.string().nullable(),
});
export type DayLogEntry = z.infer<typeof dayLogEntrySchema>;

/** One edit waiting for the caller's approval. */
export const dayLogApprovalRowSchema = z.object({
  entryId: z.string().uuid(),
  userId: z.string().uuid(),
  userName: z.string(),
  date: z.string(),
  current: z.object({
    fromTime: z.string(),
    toTime: z.string().nullable(),
    description: z.string(),
    orderCode: z.string().nullable(),
  }),
  proposed: z.object({
    fromTime: z.string(),
    toTime: z.string(),
    description: z.string(),
    orderCode: z.string().nullable(),
  }),
  requestedAt: z.string(),
});
export type DayLogApprovalRow = z.infer<typeof dayLogApprovalRowSchema>;

export const dayLogApprovalsResponseSchema = z.object({ rows: z.array(dayLogApprovalRowSchema) });
export type DayLogApprovalsResponse = z.infer<typeof dayLogApprovalsResponseSchema>;

/** Approve / Reject name the request the approver SAW (its requestedAt), so
 *  a newer edit sent meanwhile is never decided unseen (§20.2). */
export const dayLogApproveInputSchema = z.object({ requestedAt: z.string() });
export type DayLogApproveInput = z.infer<typeof dayLogApproveInputSchema>;

export const dayLogRejectInputSchema = z.object({
  requestedAt: z.string(),
  reason: z.string().trim().min(3, 'Give a reason').max(500),
});
export type DayLogRejectInput = z.infer<typeof dayLogRejectInputSchema>;

export const dayLogSummarySchema = z.object({
  workMin: z.number().int(),
  breakMin: z.number().int(),
  leaveMin: z.number().int(),
  firstStart: z.string().nullable(),
  lastStop: z.string().nullable(),
  unloggedMin: z.number().int(),
  open: z.boolean(),
  entryCount: z.number().int(),
  nextStart: z.string().nullable(),
  lateCount: z.number().int(),
  /** Minutes of a first-entry Others · Late coming (0 when none). */
  lateInMin: z.number().int(),
});
export type DayLogSummaryOut = z.infer<typeof dayLogSummarySchema>;

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
  entries: z.array(dayLogEntrySchema),
  summary: dayLogSummarySchema,
  submittedAt: z.string().nullable(),
  submittedByName: z.string().nullable(),
  leaveReason: z.string().nullable(),
  reopenedAt: z.string().nullable(),
  reopenedByName: z.string().nullable(),
  reopenReason: z.string().nullable(),
  /** An earlier working day still open: this day is locked until it is done. */
  blockedBy: z.object({ date: z.string(), reason: z.string() }).nullable(),
  /** An entry left Open on an earlier day: give it a Stop time first. */
  strayOpen: z
    .object({ date: z.string(), entryId: z.string().uuid(), fromTime: z.string() })
    .nullable(),
  isOwner: z.boolean(),
  /** Owner may add / edit / remove / submit on this day now. */
  canWrite: z.boolean(),
  /** Viewer may Reopen / mark Leave (Department Admin, Super Admin). */
  canManage: z.boolean(),
  /** Strict order: the only entry whose times may change / that may be removed. */
  lastEntryId: z.string().uuid().nullable(),
});
export type DayLogDetail = z.infer<typeof dayLogDetailSchema>;

export const teamDayLogRowSchema = z.object({
  userId: z.string().uuid(),
  userName: z.string(),
  deptLabel: z.string().nullable(),
  dayLogId: z.string().uuid().nullable(),
  status: z.enum(DAY_LOG_STATUSES),
  /** Today: what the person is doing now. A past day: submitted / leave,
   *  else idle (has entries, not submitted) / not_started (no entries). */
  currentStatus: z.enum(DAY_LOG_CURRENT_STATUSES),
  /** "GRN entry · since 14:10" / "Lunch since 13:05" / "since 11:00". */
  currentText: z.string().nullable(),
  /** Start of the Open entry ("HH:MM") — the screen ticks its elapsed time. */
  runningSince: z.string().nullable(),
  /** The Open work entry, else the latest-starting work entry. */
  latestWork: z.object({ description: z.string(), orderCode: z.string().nullable() }).nullable(),
  firstStart: z.string().nullable(),
  lastStop: z.string().nullable(),
  workMin: z.number().int(),
  breakMin: z.number().int(),
  leaveMin: z.number().int(),
  entryCount: z.number().int(),
  lateCount: z.number().int(),
  lateInMin: z.number().int(),
});
export type TeamDayLogRow = z.infer<typeof teamDayLogRowSchema>;

export const teamDayLogResponseSchema = z.object({
  date: z.string(),
  today: z.string(),
  /** Server IST "HH:MM" — the screen's clock for elapsed time. */
  nowTime: z.string(),
  workingDay: z.boolean(),
  rows: z.array(teamDayLogRowSchema),
});
export type TeamDayLogResponse = z.infer<typeof teamDayLogResponseSchema>;

export const holidaySchema = z.object({
  id: z.string().uuid(),
  date: z.string(),
  name: z.string(),
});
export type Holiday = z.infer<typeof holidaySchema>;

/** Who may open the Team Day Logs tab (drives the tab itself, §20.5). */
export const dayLogAccessSchema = z.object({
  canSeeTeam: z.boolean(),
  /** May approve other people's Day Log edits (Dept Admin / Super Admin). */
  canApprove: z.boolean(),
  canManageHolidays: z.boolean(),
});
export type DayLogAccess = z.infer<typeof dayLogAccessSchema>;
