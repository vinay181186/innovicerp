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
  operation: z.string(),
  orderQty: z.number().int(),
  completed: z.number().int().nonnegative(),
  qcAccepted: z.number().int().nonnegative(),
  qcRejected: z.number().int().nonnegative(),
  qcPending: z.number().int().nonnegative(),
  pendSince: z.string().nullable(),
  overdue: z.boolean(),
});
export type QcHistoryPendingRow = z.infer<typeof qcHistoryPendingRowSchema>;

export const qcHistoryLogRowSchema = z.object({
  logId: z.string().uuid(),
  jcCode: z.string(),
  opSeq: z.number().int(),
  soCode: z.string().nullable(),
  itemCode: z.string().nullable(),
  operation: z.string(),
  accepted: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  logDate: z.string(),
  shift: z.string().nullable(),
  inspector: z.string().nullable(),
  remarks: z.string().nullable(),
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
