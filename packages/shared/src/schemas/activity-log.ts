// Activity log shapes (T-051).
//
// Append-only audit trail per ADR-019. The `action` field is intentionally
// a free-form text — legacy emits dozens of ad-hoc strings (CREATE, EDIT,
// DELETE, RESTORE, OP START, OP COMPLETE, DISPATCH, IMPORT, PERM DELETE,
// ...). Using an enum here would force a schema change every time a new
// emitter ships.

import { z } from 'zod';
import { sfRawParamSchema } from './list-query';

export const activityLogEntrySchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  ts: z.string(), // ISO timestamp
  /** Resolved user id when the user_name maps to a known users.id;
   *  null for legacy "System" entries or hard-deleted users. */
  userId: z.string().uuid().nullable(),
  /** Snapshot of the user's display name at time of event — survives
   *  user deletion. */
  userName: z.string(),
  /** Free-form action label (CREATE / EDIT / DELETE / OP START / ...). */
  action: z.string(),
  /** What the action targeted ("Job Card", "Sales Order", etc.). */
  entity: z.string(),
  detail: z.string(),
  /** Optional reference — usually a code like "IN-JC-00002" or "bulk". */
  refId: z.string().nullable(),
  createdAt: z.string(),
  /** ADR-197 — the person's name: the row's own snapshot, else the live
   *  users.full_name, else `userName` (the e-mail) for legacy rows. */
  userFullName: z.string(),
  /** ADR-197 — uuid of the DOCUMENT the row is about; null on legacy rows,
   *  which carry only the code in `refId`. */
  entityId: z.string().uuid().nullable(),
});
export type ActivityLogEntry = z.infer<typeof activityLogEntrySchema>;

export const listActivityLogQuerySchema = z.object({
  /** Substring search across action / entity / detail / userName / refId. */
  search: z.string().trim().max(100).optional(),
  /** Filter by exact action label (case-sensitive — matches legacy data). */
  action: z.string().max(64).optional(),
  /** Filter by user id. */
  userId: z.string().uuid().optional(),
  /** First India-time day of `ts` to include (YYYY-MM-DD). */
  fromDate: z.string().optional(),
  /** Last India-time day of `ts` to include — the WHOLE day (YYYY-MM-DD). */
  toDate: z.string().optional(),
  /** Sort & Filter (ADR-200): JSON sort + column filters, see list-query.ts. */
  sf: sfRawParamSchema,
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListActivityLogQuery = z.infer<typeof listActivityLogQuerySchema>;

export const listActivityLogResponseSchema = z.object({
  entries: z.array(activityLogEntrySchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  /** Distinct action values present for the company — drives the action
   *  filter dropdown in the UI without a separate /actions endpoint. */
  actions: z.array(z.string()),
  /** Distinct {id, name} of users present in the log — drives the user
   *  filter dropdown. id is null for unmapped legacy users. */
  users: z.array(
    z.object({
      id: z.string().uuid().nullable(),
      name: z.string(),
    }),
  ),
});
export type ListActivityLogResponse = z.infer<typeof listActivityLogResponseSchema>;

// ── Per-document history (ADR-197) ─────────────────────────────────────────
// FROZEN CONTRACT — other modules build on these shapes. Add fields only as
// optional/nullable; never rename or remove one.

/** One value in a before → after pair — already formatted for reading
 *  (a date as DD-MMM-YYYY, a vendor as its code), or the raw primitive. */
export const activityChangeValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type ActivityChangeValue = z.infer<typeof activityChangeValueSchema>;

/** One edited field on one action: "Order Qty 10 → 12". */
export const activityChangeSchema = z.object({
  /** Field name in the service's shape (`orderQty`). */
  field: z.string().min(1).max(64),
  /** Screen label from docs/NAMING.md (`Order Qty`). */
  label: z.string().min(1).max(80),
  before: activityChangeValueSchema,
  after: activityChangeValueSchema,
});
export type ActivityChange = z.infer<typeof activityChangeSchema>;

/** GET /activity-log/history — one document's own trail. `entity` is a
 *  standard or legacy entity name; give `entityId`, `refId` (the document
 *  code) or both — both is best, because legacy rows carry only the code. */
export const activityHistoryQuerySchema = z
  .object({
    entity: z.string().trim().min(1).max(64),
    entityId: z.string().uuid().optional(),
    refId: z.string().trim().min(1).max(120).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(200),
  })
  .refine((q) => q.entityId !== undefined || q.refId !== undefined, {
    message: 'Give entityId or refId',
    path: ['entityId'],
  });
export type ActivityHistoryQuery = z.infer<typeof activityHistoryQuerySchema>;

/** One line of a document's History tab. */
export const activityHistoryRowSchema = z.object({
  id: z.string().uuid(),
  /** When — ISO timestamp (UTC; the web shows IST). */
  ts: z.string(),
  /** Who — the logged-in user who did it (null only on legacy "System" rows). */
  userId: z.string().uuid().nullable(),
  /** The user's name (snapshot, else live full name, else e-mail). */
  userFullName: z.string(),
  /** The operator / inspector named on the entry, when not the user. */
  operatorName: z.string().nullable(),
  /** Stored action (standard UPPER_SNAKE, or a legacy string on old rows). */
  action: z.string(),
  /** What a person reads — `activityActionLabel(action)`. */
  actionLabel: z.string(),
  /** Stored entity name (standard or legacy spelling). */
  entity: z.string(),
  entityId: z.string().uuid().nullable(),
  /** Document code, e.g. IN-PO-00012. */
  refId: z.string().nullable(),
  /** Which line of the document, e.g. "Line 2" / the SO line's POL. */
  lineRef: z.string().nullable(),
  /** Which operation, e.g. "Op 20 · Turning". */
  opRef: z.string().nullable(),
  /** Activity Qty — the quantity this one action moved; null when none. */
  qty: z.number().nullable(),
  /** Before → after per edited field; empty when nothing was edited. */
  changes: z.array(activityChangeSchema),
  /** Why — required for reject / reverse / close short / cancel / delete. */
  reason: z.string().nullable(),
  /** The one-line summary the emitter wrote (always present on old rows). */
  detail: z.string(),
});
export type ActivityHistoryRow = z.infer<typeof activityHistoryRowSchema>;

export const activityHistoryResponseSchema = z.object({
  /** Newest first. */
  rows: z.array(activityHistoryRowSchema),
});
export type ActivityHistoryResponse = z.infer<typeof activityHistoryResponseSchema>;
