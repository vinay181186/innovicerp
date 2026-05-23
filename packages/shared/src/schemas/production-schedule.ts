// Production Schedule (Gantt) shared schemas (Production slice G).
//
// 30-day Gantt grid, one row per machine, bars from jc_ops.planned_start/end.
// Mirrors legacy renderProductionSchedule (HTML L15588).

import { z } from 'zod';

export const PRODUCTION_SCHEDULE_FILTERS = ['all', 'active', 'history', 'future'] as const;
export type ProductionScheduleFilter = (typeof PRODUCTION_SCHEDULE_FILTERS)[number];

export const productionScheduleBarSchema = z.object({
  jcOpId: z.string().uuid(),
  jcId: z.string().uuid(),
  jcCode: z.string(),
  opSeq: z.number().int().positive(),
  operation: z.string(),
  itemCode: z.string().nullable(),
  plannedStart: z.string(),
  plannedEnd: z.string(),
  dueDate: z.string().nullable(),
  /** 11-state status from calc-engine. */
  status: z.string(),
  /** Pre-computed color category: ok | tight | at_risk | running | done. */
  colorKind: z.enum(['ok', 'tight', 'at_risk', 'running', 'done']),
});
export type ProductionScheduleBar = z.infer<typeof productionScheduleBarSchema>;

export const productionScheduleMachineSchema = z.object({
  machineId: z.string().uuid(),
  machineCode: z.string(),
  machineName: z.string().nullable(),
  machineType: z.string().nullable(),
  bars: z.array(productionScheduleBarSchema),
});
export type ProductionScheduleMachine = z.infer<typeof productionScheduleMachineSchema>;

export const productionScheduleStatsSchema = z.object({
  total: z.number().int().nonnegative(),
  onSchedule: z.number().int().nonnegative(),
  tight: z.number().int().nonnegative(),
  atRisk: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  unscheduled: z.number().int().nonnegative(),
});
export type ProductionScheduleStats = z.infer<typeof productionScheduleStatsSchema>;

export const productionScheduleQuerySchema = z.object({
  /** Start date of the 30-day window. YYYY-MM-DD. Defaults to today on server. */
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  filter: z.enum(PRODUCTION_SCHEDULE_FILTERS).default('all'),
});
export type ProductionScheduleQuery = z.infer<typeof productionScheduleQuerySchema>;

export interface ProductionScheduleResponse {
  startDate: string;
  filter: ProductionScheduleFilter;
  machines: ProductionScheduleMachine[];
  stats: ProductionScheduleStats;
}

export const rescheduleJcOpInputSchema = z.object({
  machineId: z.string().uuid(),
  plannedStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Optional plannedEnd — if not provided server keeps prior span (or +1 day). */
  plannedEnd: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type RescheduleJcOpInput = z.infer<typeof rescheduleJcOpInputSchema>;
