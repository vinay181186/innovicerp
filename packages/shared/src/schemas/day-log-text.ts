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
  /** Super Admin: sees revisions and may reply. */
  isSuperAdmin: z.boolean(),
  entries: z.array(dayLogPersonDayEntrySchema),
});
export type DayLogPersonDay = z.infer<typeof dayLogPersonDaySchema>;
