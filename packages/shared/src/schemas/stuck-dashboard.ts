// Stuck Activity Dashboard shared schemas.
//
// Mirror of legacy renderStuckDashboard (L18017) + _stuckThresholds (L17997).
// Scans active (not closed/cancelled/dispatched) SOs and flags any phase that
// has run past its day threshold. Read-only. Thresholds ship as constants for
// v1 (legacy stored them in db.stuckThresholds; no config store yet).

import { z } from 'zod';

export const stuckThresholdsSchema = z.object({
  design: z.number().int().positive(),
  designToPlan: z.number().int().positive(),
  planToJc: z.number().int().positive(),
  materialProc: z.number().int().positive(),
  productionOp: z.number().int().positive(),
  qc: z.number().int().positive(),
  assembly: z.number().int().positive(),
  assemblyToDispatch: z.number().int().positive(),
});
export type StuckThresholds = z.infer<typeof stuckThresholdsSchema>;

// Legacy defaults (_stuckThresholds L17998-18000).
export const DEFAULT_STUCK_THRESHOLDS: StuckThresholds = {
  design: 15,
  designToPlan: 3,
  planToJc: 2,
  materialProc: 10,
  productionOp: 5,
  qc: 3,
  assembly: 5,
  assemblyToDispatch: 2,
};

export const stuckItemSchema = z.object({
  soId: z.string().uuid(),
  soNo: z.string(),
  customer: z.string().nullable(),
  stage: z.string(),
  days: z.number().int(),
  threshold: z.number().int(),
  detail: z.string(),
  since: z.string().nullable(),
  color: z.string(),
});
export type StuckItem = z.infer<typeof stuckItemSchema>;

export const stuckDashboardResponseSchema = z.object({
  items: z.array(stuckItemSchema),
  summary: z.object({
    totalStuck: z.number().int().nonnegative(),
    criticalStuck: z.number().int().nonnegative(),
    stagesAffected: z.number().int().nonnegative(),
  }),
  thresholds: stuckThresholdsSchema,
});
export type StuckDashboardResponse = z.infer<typeof stuckDashboardResponseSchema>;
