// Machine Loading read shapes (Production Wave 3).
//
// Mirrors legacy renderLoading (HTML L5021) which consumes calcEngine()'s
// machineLoad (L1703-1715) + enrichedOps. Computed in the API service via raw
// SQL — no migration/view (like job-cards/store-inventory services).
//
// Per-machine load (legacy L1703-1715), ported to our schema where
// jc_ops.cycle_time_min is MINUTES (legacy cycleTime was hours):
//   pendingHrs  = Σ (available × cycle_time_min / 60)
//   dailyCap    = capacity_per_shift × shifts_per_day
//   weekCap     = dailyCap × 5
//   loadPct     = weekCap > 0 ? pendingHrs / weekCap : 0
//   daysToClear = dailyCap > 0 ? pendingHrs / dailyCap : 0
//   loadStatus  = loadPct>1 Overloaded · >0.7 High Load · pendingHrs>0 Manageable · Clear

import { z } from 'zod';
import { JC_PRIORITIES } from '../enums/jc-priority';

export const MACHINE_LOAD_STATUSES = [
  'Clear',
  'Manageable',
  'High Load',
  'Overloaded',
] as const;
export const machineLoadStatusSchema = z.enum(MACHINE_LOAD_STATUSES);
export type MachineLoadStatus = (typeof MACHINE_LOAD_STATUSES)[number];

/** One open operation across all machines (operation view + queue grouping). */
export const machineLoadOpSchema = z.object({
  jcOpId: z.string().uuid(),
  jobCardId: z.string().uuid(),
  jobCardCode: z.string(),
  opSeq: z.number().int(),
  operation: z.string(),
  machineId: z.string().uuid().nullable(),
  machineCode: z.string().nullable(),
  itemCode: z.string().nullable(),
  itemName: z.string().nullable(),
  soCode: z.string().nullable(),
  priority: z.enum(JC_PRIORITIES),
  dueDate: z.string().nullable(),
  orderQty: z.number().int(),
  completedQty: z.number().int().nonnegative(),
  available: z.number().int(),
  pendingHrs: z.number().nonnegative(),
  computedStatus: z.string(),
});
export type MachineLoadOp = z.infer<typeof machineLoadOpSchema>;

/** Per-machine capacity card. */
export const machineLoadCardSchema = z.object({
  machineId: z.string().uuid(),
  machineCode: z.string(),
  name: z.string(),
  machineType: z.string().nullable(),
  totalAvailQty: z.number().int().nonnegative(),
  openOps: z.number().int().nonnegative(),
  pendingHrs: z.number().nonnegative(),
  dailyCap: z.number().nonnegative(),
  weekCap: z.number().nonnegative(),
  loadPct: z.number().nonnegative(),
  daysToClear: z.number().nonnegative(),
  loadStatus: machineLoadStatusSchema,
});
export type MachineLoadCard = z.infer<typeof machineLoadCardSchema>;

export const machineLoadingResponseSchema = z.object({
  machines: z.array(machineLoadCardSchema),
  ops: z.array(machineLoadOpSchema),
});
export type MachineLoadingResponse = z.infer<typeof machineLoadingResponseSchema>;
