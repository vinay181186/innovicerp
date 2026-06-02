// SO Cycle Time report shared schemas.
//
// Mirror of legacy renderSOCycleTime (L18176) + shared engine _soPhaseData
// (L17870). Per SO: phase transition timestamps and the day-gaps between them,
// plus filtered-set averages. Read-only.

import { z } from 'zod';

// Phase transition timestamps (ISO date / timestamp strings, null = not reached).
export const soPhaseTimestampsSchema = z.object({
  soCreated: z.string().nullable(),
  designAssigned: z.string().nullable(),
  designApproved: z.string().nullable(),
  bomLinked: z.string().nullable(),
  planCreated: z.string().nullable(),
  jcCreated: z.string().nullable(),
  prRaised: z.string().nullable(),
  grnReceived: z.string().nullable(),
  firstOpStart: z.string().nullable(),
  lastOpEnd: z.string().nullable(),
  firstQcStart: z.string().nullable(),
  lastQcEnd: z.string().nullable(),
  assemblyStarted: z.string().nullable(),
  assemblyDone: z.string().nullable(),
  dispatched: z.string().nullable(),
  invoiced: z.string().nullable(),
});
export type SoPhaseTimestamps = z.infer<typeof soPhaseTimestampsSchema>;

// Durations in whole days between transitions (null when either end missing).
export const soDurationsSchema = z.object({
  design: z.number().int().nullable(),
  designToPlan: z.number().int().nullable(),
  planToJc: z.number().int().nullable(),
  materialProc: z.number().int().nullable(),
  production: z.number().int().nullable(),
  qc: z.number().int().nullable(),
  assembly: z.number().int().nullable(),
  assemblyToDispatch: z.number().int().nullable(),
  total: z.number().int().nullable(),
});
export type SoDurations = z.infer<typeof soDurationsSchema>;

export const soCycleTimeRowSchema = z.object({
  soId: z.string().uuid(),
  soNo: z.string(),
  customer: z.string().nullable(),
  type: z.string().nullable(),
  status: z.string(),
  orderQty: z.number().nonnegative(),
  dueDate: z.string().nullable(),
  phases: soPhaseTimestampsSchema,
  durations: soDurationsSchema,
});
export type SoCycleTimeRow = z.infer<typeof soCycleTimeRowSchema>;

export const soCycleTimeResponseSchema = z.object({
  rows: z.array(soCycleTimeRowSchema),
  averages: z.object({
    design: z.number().int().nonnegative(),
    production: z.number().int().nonnegative(),
    qc: z.number().int().nonnegative(),
    assembly: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
});
export type SoCycleTimeResponse = z.infer<typeof soCycleTimeResponseSchema>;
