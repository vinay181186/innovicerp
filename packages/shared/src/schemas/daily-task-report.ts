// Daily Task Reports shared schemas (migration 0051). Mirror of legacy
// renderDailyReports (HTML L14141) + _addDailyReport / _editDailyReport /
// _viewDailyReport. User-submitted "what I did today" reports. Each report's
// task lines live in their own rows (daily_report_lines) — no embedded JSON
// array (CLAUDE.md anti-pattern #1).
//
// NOTE: distinct from `daily-report.ts` (the PRODUCTION op-log machine report,
// legacy singular renderDailyReport L10823).

import { z } from 'zod';
import { DAILY_REPORT_LINE_STATUSES } from '../enums/daily-report-line-status';
import { SHIFTS } from '../enums/shift';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const dailyTaskReportLineInputSchema = z.object({
  description: z.string().min(1).max(500),
  ref: z.string().max(64).optional(),
  hours: z.coerce.number().min(0).max(24),
  status: z.enum(DAILY_REPORT_LINE_STATUSES).default('completed'),
  remarks: z.string().max(500).optional(),
});
export type DailyTaskReportLineInput = z.infer<typeof dailyTaskReportLineInputSchema>;

export const upsertDailyTaskReportInputSchema = z.object({
  reportDate: dateStr,
  shift: z.enum(SHIFTS).default('day'),
  lines: z.array(dailyTaskReportLineInputSchema).min(1, 'Add at least one task'),
});
export type UpsertDailyTaskReportInput = z.infer<typeof upsertDailyTaskReportInputSchema>;

export const dailyTaskReportLineSchema = z.object({
  id: z.string().uuid(),
  lineNo: z.number().int(),
  description: z.string(),
  ref: z.string().nullable(),
  hours: z.number(),
  status: z.enum(DAILY_REPORT_LINE_STATUSES),
  remarks: z.string().nullable(),
});
export type DailyTaskReportLine = z.infer<typeof dailyTaskReportLineSchema>;

export const dailyTaskReportRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid().nullable(),
  userName: z.string().nullable(),
  reportDate: z.string(),
  shift: z.enum(SHIFTS),
  taskCount: z.number().int().nonnegative(),
  totalHours: z.number(),
  canEdit: z.boolean(),
});
export type DailyTaskReportRow = z.infer<typeof dailyTaskReportRowSchema>;

export const dailyTaskReportDetailSchema = dailyTaskReportRowSchema.extend({
  lines: z.array(dailyTaskReportLineSchema),
});
export type DailyTaskReportDetail = z.infer<typeof dailyTaskReportDetailSchema>;

export const listDailyTaskReportsResponseSchema = z.object({
  reports: z.array(dailyTaskReportRowSchema),
  isAdmin: z.boolean(),
  userOptions: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
});
export type ListDailyTaskReportsResponse = z.infer<typeof listDailyTaskReportsResponseSchema>;
