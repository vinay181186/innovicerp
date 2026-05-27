// Incoming QC read shapes (QC Wave 2).
//
// Mirrors legacy renderIncomingQC (HTML L23748): the inspection queue for
// received GRN lines awaiting QC. Read-only aggregation over
// goods_receipt_note_lines (qc_status/qc_accepted_qty/qc_rejected_qty/qc_date).
// The "Inspect" action links to the GRN detail page, where the existing
// goods-receipt-notes update flow writes QC + the store transaction — we do
// NOT duplicate that write here.

import { z } from 'zod';

export const incomingQcPendingRowSchema = z.object({
  grnLineId: z.string().uuid(),
  grnId: z.string().uuid(),
  grnNo: z.string(),
  grnDate: z.string(),
  poCode: z.string().nullable(),
  vendorName: z.string().nullable(),
  itemCode: z.string().nullable(),
  itemName: z.string().nullable(),
  receivedQty: z.number().int(),
  pendingQty: z.number().int(),
  waitDays: z.number().int().nonnegative(),
});
export type IncomingQcPendingRow = z.infer<typeof incomingQcPendingRowSchema>;

export const incomingQcDispositionSchema = z.enum(['Accepted', 'Partial Accept', 'Rejected']);
export type IncomingQcDisposition = z.infer<typeof incomingQcDispositionSchema>;

export const incomingQcCompletedRowSchema = z.object({
  grnLineId: z.string().uuid(),
  grnId: z.string().uuid(),
  grnNo: z.string(),
  grnDate: z.string(),
  qcDate: z.string().nullable(),
  respDays: z.number().int().nullable(),
  vendorName: z.string().nullable(),
  itemCode: z.string().nullable(),
  itemName: z.string().nullable(),
  receivedQty: z.number().int(),
  acceptedQty: z.number().int(),
  rejectedQty: z.number().int(),
  disposition: incomingQcDispositionSchema,
  qcRemarks: z.string().nullable(),
  // QC report attachment (migration 0043) — Storage path + file name for the
  // inspection report on this GRN line (legacy _viewQCReport, HTML L23860).
  qcReportPath: z.string().nullable(),
  qcReportName: z.string().nullable(),
});
export type IncomingQcCompletedRow = z.infer<typeof incomingQcCompletedRowSchema>;

export const incomingQcMetricsSchema = z.object({
  grnsWaiting: z.number().int().nonnegative(),
  pendingQty: z.number().int().nonnegative(),
  avgWaitDays: z.number().nonnegative(),
  oldestDays: z.number().int().nonnegative(),
  oldestGrnNo: z.string().nullable(),
  // Σ over pending GRN lines of pendingQty × po_lines.rate (legacy "Value in
  // QC", HTML L23839). Money stuck waiting for inspection.
  valueInQc: z.number().nonnegative(),
  todayAcceptedQty: z.number().int().nonnegative(),
  todayAcceptedGrns: z.number().int().nonnegative(),
  todayRejectedQty: z.number().int().nonnegative(),
});
export type IncomingQcMetrics = z.infer<typeof incomingQcMetricsSchema>;

export const incomingQcResponseSchema = z.object({
  metrics: incomingQcMetricsSchema,
  pending: z.array(incomingQcPendingRowSchema),
  completed: z.array(incomingQcCompletedRowSchema),
});
export type IncomingQcResponse = z.infer<typeof incomingQcResponseSchema>;
