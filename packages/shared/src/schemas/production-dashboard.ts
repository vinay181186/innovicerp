// Production Dashboard read shapes (Production Wave 4).
//
// Mirrors legacy renderDashboard (HTML L3658) which consumes calcEngine()'s
// enrichedOps + jcStatus. Computed in the API service via raw SQL over
// v_jc_status + v_jc_op_status (no migration).

import { z } from 'zod';
import { JC_PRIORITIES } from '../enums/jc-priority';

export const productionDashboardCountersSchema = z.object({
  openJc: z.number().int().nonnegative(),
  totalJc: z.number().int().nonnegative(),
  noOpsJc: z.number().int().nonnegative(),
  runningOps: z.number().int().nonnegative(),
  pendingQty: z.number().int().nonnegative(),
  readyOps: z.number().int().nonnegative(),
  readyQty: z.number().int().nonnegative(),
  outsourceOps: z.number().int().nonnegative(),
  atVendor: z.number().int().nonnegative(),
});
export type ProductionDashboardCounters = z.infer<typeof productionDashboardCountersSchema>;

export const productionDashboardJcSchema = z.object({
  jobCardId: z.string().uuid(),
  code: z.string(),
  itemCode: z.string().nullable(),
  itemName: z.string().nullable(),
  priority: z.enum(JC_PRIORITIES),
  orderQty: z.number().int(),
  doneOps: z.number().int().nonnegative(),
  totalOps: z.number().int().nonnegative(),
  dueDate: z.string().nullable(),
});
export type ProductionDashboardJc = z.infer<typeof productionDashboardJcSchema>;

export const productionDashboardReadyOpSchema = z.object({
  jcOpId: z.string().uuid(),
  jobCardCode: z.string(),
  opSeq: z.number().int(),
  operation: z.string(),
  machineCode: z.string().nullable(),
  orderQty: z.number().int(),
  completedQty: z.number().int().nonnegative(),
  available: z.number().int(),
  pendingHrs: z.number().nonnegative(),
  computedStatus: z.string(),
});
export type ProductionDashboardReadyOp = z.infer<typeof productionDashboardReadyOpSchema>;

export const productionDashboardResponseSchema = z.object({
  counters: productionDashboardCountersSchema,
  openJobCards: z.array(productionDashboardJcSchema),
  readyToProcess: z.array(productionDashboardReadyOpSchema),
});
export type ProductionDashboardResponse = z.infer<typeof productionDashboardResponseSchema>;
