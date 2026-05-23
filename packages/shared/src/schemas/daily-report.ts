// Daily Report shared schemas (Production slice C).
//
// Per-day production summary grouped by machine. Mirrors legacy
// renderDailyReport (HTML L10823).

import { z } from 'zod';

export const dailyReportRowSchema = z.object({
  logId: z.string().uuid(),
  jcCode: z.string(),
  itemCode: z.string().nullable(),
  itemName: z.string().nullable(),
  opSeq: z.number().int().positive(),
  operation: z.string(),
  shift: z.string(),
  qty: z.number().int().positive(),
  operator: z.string().nullable(),
  remarks: z.string().nullable(),
});
export type DailyReportRow = z.infer<typeof dailyReportRowSchema>;

export const dailyReportMachineGroupSchema = z.object({
  machineId: z.string().uuid().nullable(),
  machineCode: z.string(),
  machineName: z.string().nullable(),
  totalQty: z.number().int().nonnegative(),
  rows: z.array(dailyReportRowSchema),
});
export type DailyReportMachineGroup = z.infer<typeof dailyReportMachineGroupSchema>;

export const dailyReportSummarySchema = z.object({
  totalPieces: z.number().int().nonnegative(),
  logEntries: z.number().int().nonnegative(),
  machinesActive: z.number().int().nonnegative(),
  jcsActive: z.number().int().nonnegative(),
});
export type DailyReportSummary = z.infer<typeof dailyReportSummarySchema>;

export const dailyReportQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  machineId: z.string().uuid().optional(),
});
export type DailyReportQuery = z.infer<typeof dailyReportQuerySchema>;

export interface DailyReportResponse {
  date: string;
  machineId: string | null;
  summary: DailyReportSummary;
  groups: DailyReportMachineGroup[];
}
