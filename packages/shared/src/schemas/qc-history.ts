// QC History read shapes (QC Wave 2).
//
// Mirrors legacy renderQCHistory (HTML L23531): pending QC ops + completed QC
// log entries + tracking stats. Read-only over op_log (log_type='qc') +
// v_jc_op_status. No migration.

import { z } from 'zod';

export const qcHistoryPendingRowSchema = z.object({
  jcOpId: z.string().uuid(),
  jobCardId: z.string().uuid(),
  jcCode: z.string(),
  opSeq: z.number().int(),
  soCode: z.string().nullable(),
  itemCode: z.string().nullable(),
  /** The customer's drawing revision for this op's part, read off the SO line
   *  the job card was raised against (job_cards.source_so_line_id →
   *  sales_order_lines.revision). Null whenever the card has no SO behind it —
   *  a JW-sourced or standalone card, or an SO line since deleted — and null
   *  must render as the bare item code, never as a dangling slash. It is never
   *  items.revision, a different column about the item master: showing that to
   *  an inspector would be a plausible-looking lie about which drawing to
   *  check against. */
  itemRevision: z.string().nullable().default(null),
  /** The part being made. A job-card number says WHICH JOB, not which part, so
   *  every screen that prints a JC number names the item beside it. Joined from
   *  the card's item (job_cards.item_id -> items), which is NOT NULL. */
  itemName: z.string().nullable().default(null),
  operation: z.string(),
  orderQty: z.number().int(),
  completed: z.number().int().nonnegative(),
  qcAccepted: z.number().int().nonnegative(),
  qcRejected: z.number().int().nonnegative(),
  qcPending: z.number().int().nonnegative(),
  pendSince: z.string().nullable(),
  overdue: z.boolean(),
  // Legacy renderQCDashboard L4135/L4140: client PO line tag + QC call date.
  clientPoLineNo: z.string().nullable(),
  qcCallDate: z.string().nullable(),
});
export type QcHistoryPendingRow = z.infer<typeof qcHistoryPendingRowSchema>;

export const qcHistoryLogRowSchema = z.object({
  logId: z.string().uuid(),
  jcCode: z.string(),
  opSeq: z.number().int(),
  soCode: z.string().nullable(),
  itemCode: z.string().nullable(),
  /** The customer's drawing revision for the inspected part, read off the SO
   *  line the job card was raised against (job_cards.source_so_line_id →
   *  sales_order_lines.revision). Null on a JW-sourced or standalone card, and
   *  null renders as the bare item code. Never items.revision — that column
   *  describes the item master and would put the wrong drawing revision in
   *  front of whoever reads the QC log back. */
  itemRevision: z.string().nullable().default(null),
  /** The part being made. A job-card number says WHICH JOB, not which part, so
   *  every screen that prints a JC number names the item beside it. Joined from
   *  the card's item (job_cards.item_id -> items), which is NOT NULL. */
  itemName: z.string().nullable().default(null),
  operation: z.string(),
  accepted: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  logDate: z.string(),
  /** ISO timestamp the QC log was recorded (for time-ordering the completed feed). */
  loggedAt: z.string(),
  shift: z.string().nullable(),
  inspector: z.string().nullable(),
  remarks: z.string().nullable(),
  // Legacy renderQCDashboard L4215/L4198: completion log no (mono) + the op's
  // QC call date so the card can show Called → Attended — Response: N days.
  logNo: z.string(),
  qcCallDate: z.string().nullable(),
  // QC report attachment (migration 0043) — Storage path + file name when the
  // inspector attached a report (legacy L4216 📎 download link).
  qcReportPath: z.string().nullable(),
  qcReportName: z.string().nullable(),
});
export type QcHistoryLogRow = z.infer<typeof qcHistoryLogRowSchema>;

export const qcHistoryStatsSchema = z.object({
  pendingOps: z.number().int().nonnegative(),
  overdue: z.number().int().nonnegative(),
  totalEntries: z.number().int().nonnegative(),
  today: z.number().int().nonnegative(),
});
export type QcHistoryStats = z.infer<typeof qcHistoryStatsSchema>;

export const qcHistoryResponseSchema = z.object({
  stats: qcHistoryStatsSchema,
  pending: z.array(qcHistoryPendingRowSchema),
  logs: z.array(qcHistoryLogRowSchema),
});
export type QcHistoryResponse = z.infer<typeof qcHistoryResponseSchema>;
