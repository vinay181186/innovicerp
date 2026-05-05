// Activity log shapes (T-051).
//
// Append-only audit trail per ADR-019. The `action` field is intentionally
// a free-form text — legacy emits dozens of ad-hoc strings (CREATE, EDIT,
// DELETE, RESTORE, OP START, OP COMPLETE, DISPATCH, IMPORT, PERM DELETE,
// ...). Using an enum here would force a schema change every time a new
// emitter ships.

import { z } from 'zod';

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
});
export type ActivityLogEntry = z.infer<typeof activityLogEntrySchema>;

export const listActivityLogQuerySchema = z.object({
  /** Substring search across action / entity / detail / userName / refId. */
  search: z.string().trim().max(100).optional(),
  /** Filter by exact action label (case-sensitive — matches legacy data). */
  action: z.string().max(64).optional(),
  /** Filter by user id. */
  userId: z.string().uuid().optional(),
  /** Inclusive lower-bound for `ts` (ISO date or datetime). */
  fromDate: z.string().optional(),
  /** Inclusive upper-bound for `ts` (ISO date or datetime). */
  toDate: z.string().optional(),
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
