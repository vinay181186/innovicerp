// QC engineer dashboard shapes (T-040g).
//
// Single aggregate read endpoint. Mirrors legacy renderQCEngineerDash
// (HTML L3963-4124) trimmed of the inline QC entry form — that flow now
// lives on /op-entry (T-040d QC sub-form), reached via deep link from
// pending rows here.
//
// Endpoint: GET /qc-dashboard?month=YYYY-MM&engineer=<name?>
// Role gate: admin / manager / viewer / qc.

import { z } from 'zod';

export const qcDashboardQuerySchema = z.object({
  /** Month for monthly aggregates, format YYYY-MM. Default = current month. */
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month must be YYYY-MM')
    .optional(),
  /** Optional engineer (operator) name filter — narrows today + month aggregates. */
  engineer: z.string().trim().min(1).max(100).optional(),
});
export type QcDashboardQuery = z.infer<typeof qcDashboardQuerySchema>;

export const qcDashboardSummarySchema = z.object({
  pendingCalls: z.number().int().nonnegative(),
  overdueCalls: z.number().int().nonnegative(),
  inspectedToday: z.number().int().nonnegative(),
  acceptedToday: z.number().int().nonnegative(),
  rejectedToday: z.number().int().nonnegative(),
  /** Today accept rate as percent 0-100; null when nothing inspected today. */
  todayRatePct: z.number().int().min(0).max(100).nullable(),
  monthCalls: z.number().int().nonnegative(),
  monthAccepted: z.number().int().nonnegative(),
  monthRejected: z.number().int().nonnegative(),
  /** Month accept rate as percent 0-100; null when no calls this month. */
  monthRatePct: z.number().int().min(0).max(100).nullable(),
});
export type QcDashboardSummary = z.infer<typeof qcDashboardSummarySchema>;

export const qcPendingRowSchema = z.object({
  jcOpId: z.string().uuid(),
  jcId: z.string().uuid(),
  jcCode: z.string(),
  opSeq: z.number().int().positive(),
  operation: z.string(),
  itemCode: z.string().nullable(),
  soCode: z.string().nullable(),
  qcPending: z.number().int().nonnegative(),
  /** ISO date string for the call date; null when not yet called. */
  qcCallDate: z.string().nullable(),
  /** Whole-day age since qc_call_date; null when no call date. */
  waitDays: z.number().int().nonnegative().nullable(),
});
export type QcPendingRow = z.infer<typeof qcPendingRowSchema>;

export const qcEngineerPerfRowSchema = z.object({
  engineer: z.string(),
  calls: z.number().int().nonnegative(),
  acceptedQty: z.number().int().nonnegative(),
  rejectedQty: z.number().int().nonnegative(),
  /** Accept-rate percent 0-100; null when calls=0 (defensive). */
  ratePct: z.number().int().min(0).max(100).nullable(),
  /** Average response time in days (date - qc_call_date). 1 decimal place
   *  stringified to keep numeric stable across the wire; null when no
   *  measurable response (no call dates among the engineer's logs). */
  avgResponseDays: z.string().nullable(),
});
export type QcEngineerPerfRow = z.infer<typeof qcEngineerPerfRowSchema>;

export const qcRejectionReasonRowSchema = z.object({
  reasonCategory: z.string(),
  count: z.number().int().nonnegative(),
  /** Share of all rejections this month as percent 0-100. */
  pct: z.number().int().min(0).max(100),
});
export type QcRejectionReasonRow = z.infer<typeof qcRejectionReasonRowSchema>;

export const qcDashboardResponseSchema = z.object({
  generatedAt: z.string(),
  /** Echoed back for the UI's month picker default state. */
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  /** Echoed back; null when no engineer filter applied. */
  engineer: z.string().nullable(),
  /** Distinct engineer names seen in this month's qc logs — for the dropdown. */
  engineers: z.array(z.string()),
  summary: qcDashboardSummarySchema,
  pending: z.array(qcPendingRowSchema),
  engineerPerf: z.array(qcEngineerPerfRowSchema),
  topRejectionReasons: z.array(qcRejectionReasonRowSchema),
});
export type QcDashboardResponse = z.infer<typeof qcDashboardResponseSchema>;
