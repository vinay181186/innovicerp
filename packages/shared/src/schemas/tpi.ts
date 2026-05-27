// TPI (Third Party Inspection) read shapes (QC Wave 3).
//
// Mirrors legacy renderTPI (HTML L21381). TPI ops = QC ops whose operation
// name contains "TPI". Read-only here; the submit reuses op-entry submitQcLog
// with isTpi + tpi metadata (persisted on op_log, migration 0037).

import { z } from 'zod';

export const tpiPendingRowSchema = z.object({
  jcOpId: z.string().uuid(),
  jcCode: z.string(),
  opSeq: z.number().int(),
  soCode: z.string().nullable(),
  itemCode: z.string().nullable(),
  operation: z.string(),
  orderQty: z.number().int(),
  qcPending: z.number().int().nonnegative(),
  callDate: z.string().nullable(),
  waitDays: z.number().int().nonnegative(),
});
export type TpiPendingRow = z.infer<typeof tpiPendingRowSchema>;

export const tpiCompletedRowSchema = z.object({
  logId: z.string().uuid(),
  jcCode: z.string(),
  opSeq: z.number().int(),
  soCode: z.string().nullable(),
  itemCode: z.string().nullable(),
  operation: z.string(),
  accepted: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  callDate: z.string().nullable(),
  attendedDate: z.string(),
  respDays: z.number().int().nullable(),
  inspector: z.string().nullable(),
  organization: z.string().nullable(),
  certNo: z.string().nullable(),
  // QC report attachment (migration 0043) — Storage path + file name for the
  // TPI report (legacy _tpiAttachReport, HTML L21492).
  qcReportPath: z.string().nullable(),
  qcReportName: z.string().nullable(),
});
export type TpiCompletedRow = z.infer<typeof tpiCompletedRowSchema>;

export const tpiResponseSchema = z.object({
  pending: z.array(tpiPendingRowSchema),
  completed: z.array(tpiCompletedRowSchema),
});
export type TpiResponse = z.infer<typeof tpiResponseSchema>;
