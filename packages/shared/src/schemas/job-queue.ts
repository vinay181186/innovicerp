// Job Queue shared schemas (Production slice F).
//
// Pending ops per machine, manually reorderable. Mirrors legacy
// renderJobQueue (HTML L10363).

import { z } from 'zod';

export const jobQueueRowSchema = z.object({
  jcOpId: z.string().uuid(),
  jcId: z.string().uuid(),
  jcCode: z.string(),
  itemCode: z.string().nullable(),
  itemName: z.string().nullable(),
  soCode: z.string().nullable(),
  soCustomer: z.string().nullable(),
  opSeq: z.number().int().positive(),
  operation: z.string(),
  priority: z.string(),
  dueDate: z.string().nullable(),
  orderQty: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  available: z.number().int().nonnegative(),
  /** 11-state enum from calc-engine. */
  status: z.string(),
  /** True when this op has an active running_ops record. */
  isRunning: z.boolean(),
  queuePosition: z.number().int().nullable(),
});
export type JobQueueRow = z.infer<typeof jobQueueRowSchema>;

export const jobQueueMachineSchema = z.object({
  machineId: z.string().uuid(),
  machineCode: z.string(),
  machineName: z.string().nullable(),
  machineType: z.string().nullable(),
  /** Sum of (cycle_min × available) across queue, in hours. */
  pendingHrs: z.number(),
  /** Active running_ops count. */
  runningCount: z.number().int().nonnegative(),
  /** Pending ops count. */
  pendingCount: z.number().int().nonnegative(),
  rows: z.array(jobQueueRowSchema),
});
export type JobQueueMachine = z.infer<typeof jobQueueMachineSchema>;

export const jobQueueQuerySchema = z.object({
  machineId: z.string().uuid().optional(),
});
export type JobQueueQuery = z.infer<typeof jobQueueQuerySchema>;

export interface JobQueueResponse {
  machines: JobQueueMachine[];
}

export const reorderJobQueueInputSchema = z.object({
  /** Ordered list of jc_op IDs in the new queue order for this machine. */
  jcOpIds: z.array(z.string().uuid()).min(1),
});
export type ReorderJobQueueInput = z.infer<typeof reorderJobQueueInputSchema>;
