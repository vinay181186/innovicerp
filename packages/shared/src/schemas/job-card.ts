// Job Card read shapes (T-032).
//
// Read-only at this phase — JC writes still go through op-entry per Phase 3.
// This module surfaces JCs in a list view with:
//   - the derived per-JC status from `v_jc_status` (mirrors legacy
//     calcEngine().jcStatus, line 1718-1728)
//   - the source SO/JW line link from T-029d (`source_so_line_id` /
//     `source_jw_line_id` FKs added in 0008_phase4_jc_alters.sql)
//   - filters legacy users expect: status, machine (any op on this JC uses
//     this machine), operator (any op_log on this JC was logged by this
//     operator), date range, free-text search.
//
// JC detail (`GET /job-cards/:id`) returns the same row shape as the list
// item — no nested ops here. Op detail + writes live under `/op-entry/...`,
// which the JC list page links into directly.

import { z } from 'zod';
import { JC_COMPUTED_STATUSES } from '../enums/jc-computed-status';
import { JC_PRIORITIES } from '../enums/jc-priority';

export const jcComputedStatusSchema = z.enum(JC_COMPUTED_STATUSES);
export const jcPrioritySchema = z.enum(JC_PRIORITIES);

// ─── Read shape ───────────────────────────────────────────────────────────

/** Source SO line link, populated when `source_so_line_id` is non-null on
 *  the JC. Customer name is denormalised from the SO header. */
export const jobCardSourceSoLinkSchema = z.object({
  type: z.literal('so'),
  salesOrderId: z.string().uuid(),
  salesOrderLineId: z.string().uuid(),
  code: z.string(),
  lineNo: z.number().int().positive(),
  partName: z.string().nullable(),
});
export type JobCardSourceSoLink = z.infer<typeof jobCardSourceSoLinkSchema>;

export const jobCardSourceJwLinkSchema = z.object({
  type: z.literal('jw'),
  jobWorkOrderId: z.string().uuid(),
  jobWorkOrderLineId: z.string().uuid(),
  code: z.string(),
  lineNo: z.number().int().positive(),
  partName: z.string().nullable(),
});
export type JobCardSourceJwLink = z.infer<typeof jobCardSourceJwLinkSchema>;

export const jobCardSourceLinkSchema = z.discriminatedUnion('type', [
  jobCardSourceSoLinkSchema,
  jobCardSourceJwLinkSchema,
]);
export type JobCardSourceLink = z.infer<typeof jobCardSourceLinkSchema>;

export const jobCardListItemSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  code: z.string(),
  jcDate: z.string(), // ISO date
  itemId: z.string().uuid(),
  itemCode: z.string(),
  itemName: z.string(),
  orderQty: z.number().int().positive(),
  priority: jcPrioritySchema,
  dueDate: z.string().nullable(),
  drawingFilePath: z.string().nullable(),
  closedAt: z.string().nullable(),
  // Derived from v_jc_status
  computedStatus: jcComputedStatusSchema,
  totalOps: z.number().int().nonnegative(),
  doneOps: z.number().int().nonnegative(),
  qcPendingOps: z.number().int().nonnegative(),
  // Source link (or null for source-less JCs — allowed per ADR-012 #4
  // CHECK num_nonnulls(...) <= 1)
  sourceLink: jobCardSourceLinkSchema.nullable(),
  /** Customer name surfaced for the list view: prefers SO/JW source link's
   *  `customer_name`; falls back to the linked client's name when the source
   *  uses `client_id`. Null when no source link or no customer info at all. */
  customerName: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
});
export type JobCardListItem = z.infer<typeof jobCardListItemSchema>;

// ─── Query filters ────────────────────────────────────────────────────────

export const listJobCardsQuerySchema = z.object({
  /** Free-text match against jc.code, items.code, items.name,
   *  source SO/JW code, and source customerName. */
  search: z.string().min(1).max(100).optional(),
  status: jcComputedStatusSchema.optional(),
  /** Match any jc_op on this JC that uses this machine. */
  machineId: z.string().uuid().optional(),
  /** Match any op_log on this JC's ops that was logged by this operator. */
  operatorId: z.string().uuid().optional(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListJobCardsQuery = z.infer<typeof listJobCardsQuerySchema>;

export interface ListJobCardsResponse {
  items: JobCardListItem[];
  total: number;
  limit: number;
  offset: number;
}
