// Daily Report shared schemas (Production slice C).
//
// Per-day production summary grouped by machine. Mirrors legacy
// renderDailyReport (HTML L10823).

import { z } from 'zod';

export const dailyReportRowSchema = z.object({
  logId: z.string().uuid(),
  jcCode: z.string(),
  /** ADR-261 JC Date — job_cards.jc_date as 'YYYY-MM-DD'. */
  jcDate: z.string().nullable(),
  itemCode: z.string().nullable(),
  /** The customer's drawing revision behind this log entry, followed from the
   *  job card to its SO line (job_cards.source_so_line_id →
   *  sales_order_lines.revision). Null whenever there is no SO line to read —
   *  job-work and standalone cards produce log entries too — and null must show
   *  as the plain item code. Not items.revision, which is a different column
   *  about the item master and would misreport the drawing to the shop. */
  itemRevision: z.string().nullable().default(null),
  /** The customer's PO line number (`POL`) for the SO line this row traces back
   *  to — the same fact the Sales Order line carries, shown beside the item
   *  code on every downstream document (user rule, 2026-09-23). Null when the
   *  row has no SO line behind it (a job-work line, a hand-raised card).
   *  Read-only: the Sales Order is the only place it is typed. */
  clientPoLineNo: z.string().nullable().default(null),
  itemName: z.string().nullable(),
  /** ADR-261 lead columns — the order behind the card (SO code, else the JWSO
   *  code), the SO's Internal SO No., and the log entry's created_at (ISO). */
  soCode: z.string().nullable().optional(),
  soInternalNo: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
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
  /** Set -> paged (ADR-201): `groups` carry only this page's rows (machines in
   *  order, rows in order), while every group's `totalQty`, the `summary` and
   *  `total` are worked out over the WHOLE day. Unset -> the whole day. */
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
export type DailyReportQuery = z.infer<typeof dailyReportQuerySchema>;

export interface DailyReportResponse {
  date: string;
  machineId: string | null;
  summary: DailyReportSummary;
  groups: DailyReportMachineGroup[];
  /** Paged mode: log entries of the day (all pages). */
  total?: number;
}
