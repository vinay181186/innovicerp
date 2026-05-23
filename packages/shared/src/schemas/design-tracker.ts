// Design Tracker shared schemas (Design slice B).
//
// Per-SO design assignment with revision tracking. Older subsystem
// (legacy db.designTracker + db.designTimeLog). Mirrors
// renderDesignTracker (HTML L7259) + helpers L7338–7489.
// Numbering: DSN-NNNN.

import { z } from 'zod';

export const DESIGN_TRACKER_STATUSES = [
  'Pending',
  'In Progress',
  'Review',
  'Approved',
  'Revision',
] as const;
export type DesignTrackerStatus = (typeof DESIGN_TRACKER_STATUSES)[number];
export const designTrackerStatusSchema = z.enum(DESIGN_TRACKER_STATUSES);

// ─── Read shapes ───────────────────────────────────────────────────────────

export const designRevisionEntrySchema = z.object({
  rev: z.number().int().nonnegative(),
  date: z.string(),
  reason: z.string(),
  by: z.string(),
});
export type DesignRevisionEntry = z.infer<typeof designRevisionEntrySchema>;

export const designTrackerSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  code: z.string(),
  salesOrderId: z.string().uuid().nullable(),
  soCodeText: z.string().nullable(),
  itemId: z.string().uuid().nullable(),
  itemCodeText: z.string().nullable(),
  itemNameText: z.string().nullable(),
  designer: z.string(),
  estimatedHours: z.number(),
  startDate: z.string(),
  targetDate: z.string(),
  status: designTrackerStatusSchema,
  revision: z.number().int().nonnegative(),
  remarks: z.string().nullable(),
  approvedAt: z.string().nullable(),
  approvedByText: z.string().nullable(),
  reviewSubmittedAt: z.string().nullable(),
  revisionHistory: z.array(designRevisionEntrySchema),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type DesignTracker = z.infer<typeof designTrackerSchema>;

export const designTrackerListItemSchema = designTrackerSchema.extend({
  /** Σ hours from design_time_log for this design. */
  totalHours: z.number(),
});
export type DesignTrackerListItem = z.infer<typeof designTrackerListItemSchema>;

export const designTimeLogEntrySchema = z.object({
  id: z.string().uuid(),
  designTrackerId: z.string().uuid(),
  logDate: z.string(),
  hours: z.number(),
  workerText: z.string(),
  description: z.string().nullable(),
  createdAt: z.string(),
});
export type DesignTimeLogEntry = z.infer<typeof designTimeLogEntrySchema>;

// ─── Write inputs ──────────────────────────────────────────────────────────

export const createDesignTrackerInputSchema = z.object({
  salesOrderId: z.string().uuid(),
  designer: z.string().trim().min(1).max(120),
  estimatedHours: z.coerce.number().nonnegative().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  remarks: z.string().trim().max(500).optional(),
});
export type CreateDesignTrackerInput = z.infer<typeof createDesignTrackerInputSchema>;

export const updateDesignTrackerInputSchema = z.object({
  designer: z.string().trim().min(1).max(120).optional(),
  status: designTrackerStatusSchema.optional(),
  estimatedHours: z.coerce.number().nonnegative().optional(),
  targetDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  remarks: z.string().trim().max(500).optional(),
});
export type UpdateDesignTrackerInput = z.infer<typeof updateDesignTrackerInputSchema>;

export const logDesignTimeInputSchema = z.object({
  logDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hours: z.coerce.number().positive(),
  workerText: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
});
export type LogDesignTimeInput = z.infer<typeof logDesignTimeInputSchema>;

export const reviseDesignInputSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type ReviseDesignInput = z.infer<typeof reviseDesignInputSchema>;

// ─── Query filters ─────────────────────────────────────────────────────────

export const listDesignTrackerQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(),
  status: designTrackerStatusSchema.optional(),
  /** all | pending | progress | review | approved | overdue (per legacy) */
  filter: z.enum(['all', 'pending', 'progress', 'review', 'approved', 'overdue']).default('all'),
  limit: z.coerce.number().int().positive().max(200).default(100),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListDesignTrackerQuery = z.infer<typeof listDesignTrackerQuerySchema>;

export interface ListDesignTrackerResponse {
  items: DesignTrackerListItem[];
  total: number;
  limit: number;
  offset: number;
  summary: {
    total: number;
    pending: number;
    inProgress: number;
    review: number;
    approved: number;
    overdue: number;
  };
}

export interface DesignTrackerDetailResponse {
  tracker: DesignTracker;
  timeLog: DesignTimeLogEntry[];
  totalHours: number;
}
