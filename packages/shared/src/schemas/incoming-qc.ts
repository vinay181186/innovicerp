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
  /** Sales Order this OSP return traces back to (via PO line → jc_op → JC → SO); null for raw-material GRNs. */
  soCode: z.string().nullable(),
  // Job Card / operation this line feeds, off the same PO line → jc_op trace as
  // soCode. All three are null together on a raw-material receipt, which is what
  // the queue renders as "no job card" — the signal that inspecting this line
  // moves no operation anywhere.
  jcCode: z.string().nullable(),
  opSeq: z.number().int().nullable(),
  opName: z.string().nullable(),
  itemCode: z.string().nullable(),
  /** The customer's drawing revision, read off the SO line behind this line's
   *  job card along the same PO line → jc_op → JC → SO trace as soCode
   *  (sales_order_lines.revision). This queue deliberately mixes two kinds of
   *  row: an OSP return does reach an SO line and carries a revision, while a
   *  raw-material receipt from a vendor has no SO behind it at all and is
   *  correctly null here — a blank on half the rows is the truth, not a gap.
   *  Never items.revision, which is a different column about the item master. */
  itemRevision: z.string().nullable().default(null),
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
  /** The customer's drawing revision the receipt was inspected against, traced
   *  the same way as on the pending row (PO line → jc_op → JC →
   *  sales_order_lines.revision). Null on raw-material receipts, which have no
   *  SO line behind them, and null shows the bare item code. Never
   *  items.revision. */
  itemRevision: z.string().nullable().default(null),
  itemName: z.string().nullable(),
  receivedQty: z.number().int(),
  acceptedQty: z.number().int(),
  rejectedQty: z.number().int(),
  disposition: incomingQcDispositionSchema,
  /** ISO timestamp the QC was recorded (for time-ordering the completed feed). */
  qcAt: z.string().nullable(),
  /** Who did the QC — typed name, else the resolved user's name/email. */
  qcInspectedBy: z.string().nullable(),
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
  valueInQc: z.number().nonnegative().nullable(), // NULL when prices hidden
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

// ─── Inspect action (Incoming QC Call Register — inline accept/reject) ───────
// Records QC for ONE GRN line: sets qc_accepted/rejected, marks it completed,
// credits accepted qty to stock. Mirrors the GRN QC merge but narrowed to a
// single line so an inline form can't disturb the rest of the GRN.
export const submitIncomingQcInputSchema = z
  .object({
    acceptedQty: z.number().int().nonnegative(),
    rejectedQty: z.number().int().nonnegative(),
    /** Mandatory — who did the QC. Kept as a NAME even now that the field is a
     *  dropdown: a completed inspection is a record of who signed it off on the
     *  day, and it must not change if that person is later renamed or removed. */
    qcInspectedByName: z.string().trim().min(1, 'QC inspector name is required').max(120),
    /** The QC user the name was picked from, so the inspection is LINKED to a
     *  person and not just labelled with a string. Written to
     *  `goods_receipt_note_lines.qc_inspected_by`, which until now was stamped
     *  with whoever pressed Submit — that recorded the typist, not the
     *  inspector, and the two are routinely different people.
     *
     *  Optional so a caller that cannot resolve a user (an import, an inspector
     *  who is not a system account) still records the name; the column then
     *  falls back to the submitter exactly as before. The submitter stays
     *  traceable either way through `updated_by`. */
    qcInspectedByUserId: z.string().uuid().optional(),
    qcDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'qcDate must be YYYY-MM-DD')
      .optional(),
    qcRemarks: z.string().max(2000).optional(),
    qcReportPath: z.string().optional(),
    qcReportName: z.string().optional(),
  })
  .refine((v) => v.acceptedQty + v.rejectedQty > 0, {
    message: 'Enter an accept and/or reject quantity',
  });
export type SubmitIncomingQcInput = z.infer<typeof submitIncomingQcInputSchema>;
