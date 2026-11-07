// Day Log — direct edits, the entry's revisions and Super Admin replies
// (ADR-255, owner 2026-10-29; ADR-256, 2026-10-30).
//   - The owner edits Working On DIRECTLY (no approval). The owner is never
//     shown any revision fact.
//   - ADR-256 (owner 2026-10-30): Start / Stop / SO-JWSO edits are ALSO saved
//     directly (no approval), and ONE common history covers every edit: each
//     Entry Rev (0 = first save, +1 per changed save of ANY field) keeps the
//     whole entry — Working On, Start, Stop, SO / JWSO — as it was saved.
//     Edits already waiting when this shipped are still decided on
//     Approvals · Day Log (an approval adds an Entry Rev too).
//   - A Super Admin (Full Access / role admin) sees every revision and may
//     reply on an entry — many replies, each editable. The owner sees the
//     replies (latest text) and an unread mark until the entry is opened.
//   - Replies reach the owner through the Home 🔔 / Notifications panel.

import { z } from 'zod';
import {
  DAY_LOG_ENTRY_KINDS,
  dayLogEntrySchema,
  dayLogOrderSchema,
  dayLogOwnReplySchema,
} from './day-log';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// ── Inputs ──────────────────────────────────────────────────────────────────

/** PATCH /day-logs/entries/:id/work — the owner's direct Working On edit. */
export const updateDayLogWorkInputSchema = z.object({
  description: z.string().trim().min(1, 'Write what you worked on').max(2000),
  /** §20.4 — the entry's updatedAt as loaded. */
  updatedAt: z.string(),
});
export type UpdateDayLogWorkInput = z.infer<typeof updateDayLogWorkInputSchema>;

/** POST /day-logs/entries/:id/replies — Super Admin only. */
export const sendDayLogReplyInputSchema = z.object({
  body: z.string().trim().min(1, 'Write the reply').max(2000),
});
export type SendDayLogReplyInput = z.infer<typeof sendDayLogReplyInputSchema>;

/** PATCH /day-logs/replies/:id — Super Admin only; §20.4 updatedAt. */
export const editDayLogReplyInputSchema = z.object({
  body: z.string().trim().min(1, 'Write the reply').max(2000),
  updatedAt: z.string(),
});
export type EditDayLogReplyInput = z.infer<typeof editDayLogReplyInputSchema>;

/** POST /day-logs/day-replies — Super Admin, on a person's blank day. */
export const sendDayLogDayReplyInputSchema = z.object({
  userId: z.string().uuid(),
  date: dateStr,
  body: z.string().trim().min(1, 'Write the reply').max(2000),
});
export type SendDayLogDayReplyInput = z.infer<typeof sendDayLogDayReplyInputSchema>;

/** POST /day-logs/day-replies/seen — the owner opened this date. */
export const dayLogDayRepliesSeenInputSchema = z.object({ date: dateStr });
export type DayLogDayRepliesSeenInput = z.infer<typeof dayLogDayRepliesSeenInputSchema>;

/** GET /day-logs/person-day — Team Day Logs › a person, one day. */
export const dayLogPersonDayQuerySchema = z.object({
  userId: z.string().uuid(),
  date: dateStr.optional(),
});
export type DayLogPersonDayQuery = z.infer<typeof dayLogPersonDayQuerySchema>;

// ── Read models ─────────────────────────────────────────────────────────────

/** A reply as the Super Admin sees it (Team Day Logs). */
export const dayLogAdminReplySchema = dayLogOwnReplySchema.omit({ unread: true }).extend({
  /** When the owner first opened it (since the last edit); null = not seen. */
  seenAt: z.string().nullable(),
  /** §20.4 — sent back by an edit. */
  updatedAt: z.string(),
  /** §20.5 — only the author may edit; the screen shows ✎ only then. */
  canEdit: z.boolean(),
});
export type DayLogAdminReply = z.infer<typeof dayLogAdminReplySchema>;

/** ADR-256 — one saved version of an entry (Entry Rev): the whole entry as
 *  it was then. Old revisions saved before ADR-256 carry the entry's Start /
 *  Stop / SO as they were when ADR-256 shipped. */
export const dayLogEntryRevisionSchema = z.object({
  /** 0 = first save. */
  entryRevNo: z.number().int().nonnegative(),
  description: z.string(),
  fromTime: z.string().nullable(),
  toTime: z.string().nullable(),
  order: dayLogOrderSchema.nullable(),
  savedAt: z.string(),
});
export type DayLogEntryRevision = z.infer<typeof dayLogEntryRevisionSchema>;

/** One entry on the person page (Team Day Logs › a person, one day). */
export const dayLogPersonDayEntrySchema = z.object({
  id: z.string().uuid(),
  /** Sr No — position by Start Time. */
  srNo: z.number().int().positive(),
  /** Log Date / Log Time: when the entry was FIRST saved. */
  loggedAt: z.string(),
  fromTime: z.string(),
  toTime: z.string().nullable(),
  minutes: z.number().int(),
  order: dayLogOrderSchema.nullable(),
  description: z.string(),
  /** Entry Rev No — Super Admin only (null for anyone else). */
  entryRevNo: z.number().int().nonnegative().nullable(),
  /** When the latest Entry Rev was saved; null at Entry Rev 0 or not Super Admin. */
  entryRevisedAt: z.string().nullable(),
  /** Every Entry Rev, newest first. Empty unless Super Admin. */
  revisions: z.array(dayLogEntryRevisionSchema),
  /** Oldest first. Empty unless Super Admin. */
  replies: z.array(dayLogAdminReplySchema),
});
export type DayLogPersonDayEntry = z.infer<typeof dayLogPersonDayEntrySchema>;

export const dayLogPersonDaySchema = z.object({
  userId: z.string().uuid(),
  userName: z.string(),
  deptLabel: z.string().nullable(),
  date: z.string(),
  /** Server's IST today (the date picker's max). */
  today: z.string(),
  /** Super Admin: sees every Entry Rev — on their own day too (ADR-256). */
  isSuperAdmin: z.boolean(),
  /** Super Admin on someone else's day: sees the replies and may reply. */
  canReply: z.boolean(),
  entries: z.array(dayLogPersonDayEntrySchema),
  /** Replies on the day itself, oldest first. Empty unless Super Admin. */
  dayReplies: z.array(dayLogAdminReplySchema),
  /** Super Admin on someone else's blank working day (today or earlier). */
  canReplyDay: z.boolean(),
  /** ADR-274 — a reply here raises a task: false when the person's Task Board is hidden. */
  replyGoesToInbox: z.boolean(),
  /** Blank working day before today, from companies.day_log_pending_from. Super Admin only. */
  notEntered: z.boolean(),
});
export type DayLogPersonDay = z.infer<typeof dayLogPersonDaySchema>;

// ── Pending Entries (owner 2026-11-05) ──────────────────────────────────────

/** GET /day-logs/pending/mine — drives the banner on every page. */
export const dayLogMyPendingSchema = z.object({ dates: z.array(z.string()) });
export type DayLogMyPending = z.infer<typeof dayLogMyPendingSchema>;

/** One person + one pending date on the Pending Entries tab. */
export const dayLogPendingRowSchema = z.object({
  userId: z.string().uuid(),
  userName: z.string(),
  deptLabel: z.string().nullable(),
  date: z.string(),
  /** Calendar days from the date to today. */
  daysPending: z.number().int().positive(),
  /** The open task from a reply, else null. */
  taskCode: z.string().nullable(),
  replyCount: z.number().int().nonnegative(),
  /** Replies the person has not opened. */
  unseenCount: z.number().int().nonnegative(),
});
export type DayLogPendingRow = z.infer<typeof dayLogPendingRowSchema>;

/** GET /day-logs/pending — Super Admin only; oldest date first. */
export const dayLogPendingResponseSchema = z.object({
  today: z.string(),
  rows: z.array(dayLogPendingRowSchema),
});
export type DayLogPendingResponse = z.infer<typeof dayLogPendingResponseSchema>;

/** GET /day-logs/pending/:id/calendar — Super Admin only: one person's dates for
 *  the Pending Entries calendar. Every list is 'YYYY-MM-DD', oldest first. */
export const dayLogPendingCalendarSchema = z.object({
  userId: z.string().uuid(),
  userName: z.string(),
  deptLabel: z.string().nullable(),
  today: z.string(),
  /** 'YYYY-MM': the earliest month the calendar opens (the person's start). */
  firstMonth: z.string(),
  /** Has a saved entry: green. */
  filled: z.array(z.string()),
  /** The same dates as this person's banner: red. */
  pending: z.array(z.string()),
  /** Has a Super Admin reply, on the day or on one of its entries. */
  replied: z.array(z.string()),
  holidays: z.array(z.string()),
});
export type DayLogPendingCalendar = z.infer<typeof dayLogPendingCalendarSchema>;

// ── Day Log History (owner 2026-11-06, ADR-278) ───────────────────────────────
// Super Admin: one person's dates, From Date to To Date, for the History PDF. The
// server decides every state and total; the screen and the PDF only draw them.

/** The longest History range in days: any 3 calendar months fit. */
export const DAY_LOG_HISTORY_MAX_DAYS = 92;

export const dayLogHistoryQuerySchema = z.object({
  userId: z.string().uuid(),
  /** YYYY-MM-DD: From Date. One date = the same date in both. */
  from: dateStr,
  /** YYYY-MM-DD: To Date. */
  to: dateStr,
});
export type DayLogHistoryQuery = z.infer<typeof dayLogHistoryQuerySchema>;

const DAY_MS = 86_400_000;

/** Calendar days from one YYYY-MM-DD to another, both counted; NaN if not a date. */
const daysInRange = (from: string, to: string): number =>
  (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS + 1;

const isCalendarDate = (d: string): boolean => {
  const t = Date.parse(`${d}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
};

/** Why a History range cannot be read, else null. The screen and the server ask
 *  this one rule. `today` is the server's IST date. */
export function dayLogHistoryRangeError(from: string, to: string, today: string): string | null {
  if (!isCalendarDate(from)) return 'Pick a real From Date.';
  if (!isCalendarDate(to)) return 'Pick a real To Date.';
  // A half-typed year (0002) is not a date the database can read.
  if (from < '2000-01-01') return 'Pick a date from the year 2000 on.';
  if (from > to) return 'From Date cannot be after To Date.';
  if (to > today) return 'A date after today has no Day Log.';
  if (daysInRange(from, to) > DAY_LOG_HISTORY_MAX_DAYS) {
    return `Pick ${DAY_LOG_HISTORY_MAX_DAYS} days or less (about 3 months).`;
  }
  return null;
}

/** One date's state. `filled` wins over Sunday / holiday when entries exist.
 *  `not_counted`: a blank date the Not entered rule does not count (before the
 *  start date, or a person who keeps no Day Log). */
export const DAY_LOG_HISTORY_DAY_STATES = [
  'filled',
  'today',
  'not_entered',
  'not_counted',
  'leave',
  'sunday',
  'holiday',
] as const;
export type DayLogHistoryDayState = (typeof DAY_LOG_HISTORY_DAY_STATES)[number];

export const dayLogHistoryEntrySchema = dayLogPersonDayEntrySchema.extend({
  /** Old rows may be break / leave (shown as Others); they never count as Working hours. */
  kind: z.enum(DAY_LOG_ENTRY_KINDS),
  /** An old edit still waiting for approval, else null. */
  pending: dayLogEntrySchema.shape.pending,
  /** The IST date it was first saved, when later than the date it is for; else null. */
  savedLaterOn: z.string().nullable(),
});
export type DayLogHistoryEntry = z.infer<typeof dayLogHistoryEntrySchema>;

export const dayLogHistoryDaySchema = z.object({
  date: z.string(),
  state: z.enum(DAY_LOG_HISTORY_DAY_STATES),
  holidayName: z.string().nullable(),
  firstStart: z.string().nullable(),
  lastStop: z.string().nullable(),
  /** The same reading as Team Day Logs (summaryOf). */
  workMin: z.number().int(),
  entryCount: z.number().int(),
  /** This date's entries with at least one edit. */
  editedEntries: z.number().int(),
  /** Entry Revs after the first save, on this date's entries. */
  edits: z.number().int(),
  /** Replies on entries + on the blank date. */
  replies: z.number().int(),
  /** Entries first saved on a later date than this one. */
  savedLater: z.number().int(),
  entries: z.array(dayLogHistoryEntrySchema),
  /** Replies on the blank date, oldest first. */
  dayReplies: z.array(dayLogAdminReplySchema),
});
export type DayLogHistoryDay = z.infer<typeof dayLogHistoryDaySchema>;

export const dayLogHistorySchema = z.object({
  userId: z.string().uuid(),
  userName: z.string(),
  deptLabel: z.string().nullable(),
  /** From Date and To Date as asked for; the same date for one date. */
  from: z.string(),
  to: z.string(),
  /** Server's IST today (the pickers' max). */
  today: z.string(),
  /** In date order, never past today. */
  days: z.array(dayLogHistoryDaySchema),
  totals: z.object({
    /** filledDays + notEntered. */
    workingDays: z.number().int(),
    filledDays: z.number().int(),
    notEntered: z.number().int(),
    /** Sunday / holiday dates with no entry. */
    offDays: z.number().int(),
    /** Old Leave dates with no entry. */
    leaveDays: z.number().int(),
    entries: z.number().int(),
    workMin: z.number().int(),
    /** workMin / filledDays to the minute; 0 with no filled day. */
    avgDailyWorkMin: z.number().int(),
    breakMin: z.number().int(),
    leaveMin: z.number().int(),
    editedEntries: z.number().int(),
    edits: z.number().int(),
    replies: z.number().int(),
    savedLater: z.number().int(),
  }),
  /** False: nothing to print, so no PDF (no working day, no old Leave day, no reply). */
  hasContent: z.boolean(),
});
export type DayLogHistory = z.infer<typeof dayLogHistorySchema>;
