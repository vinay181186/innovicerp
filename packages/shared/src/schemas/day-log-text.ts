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
import { dayLogOrderSchema, dayLogOwnReplySchema } from './day-log';

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
