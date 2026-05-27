// SO QC Status read shapes (QC Wave 4 + 2026-05-24 GRN-QC/Docs + 2026-05-27
// legacy-parity rebuild). Mirrors legacy renderSOQCStatus (HTML L18347):
// per-SO selector -> per-line QC-stage rollup with the rich "QC Stages (in JC)"
// cell, an overall % progress bar, and an expandable detail row (Incoming
// Material QC / TPI / QC Documents sub-tables).
//
// All four legacy stages attributable per SO line:
//   • QC Ops — job_cards.source_so_line_id -> v_jc_op_status (per JC, per op)
//   • TPI    — op_log.is_tpi on the same JCs
//   • GRN-QC — goods_receipt_note_lines -> purchase_order_lines
//              (source_so_line_id, or source_jc_op_id -> jc_ops -> job_cards)
//   • Docs   — qc_documents.job_card_id -> job_cards.source_so_line_id
// Read-only, no migration. See docs/PARITY/qc-so-status.md.
//
// NOTE (deferred): the per-GRN-line / per-TPI "Report View" download link is
// owned by a separate QC-report-attachment task and is intentionally NOT part
// of these detail shapes.

import { z } from 'zod';

export const soQcSelectorSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  customerName: z.string().nullable(),
  status: z.string(),
  soDate: z.string().nullable(),
  // Legacy SO header L18376-18381 — Due date + Type alongside SO Date.
  dueDate: z.string().nullable(),
  type: z.string().nullable(),
});
export type SoQcSelector = z.infer<typeof soQcSelectorSchema>;

export const soQcOverallSchema = z.enum(['none', 'pending', 'in_progress', 'passed']);
export type SoQcOverall = z.infer<typeof soQcOverallSchema>;

// Per-QC-op stage status (legacy L18412): icon driven.
//   passed     — accepted >= input qty (✅)
//   passed_rej — passed but some rejection occurred (✅ + (N rej))
//   in_progress— inspected, still pending qty (⏳)
//   no_pass    — qc op exists, never inspected (❌)
export const soQcStageStatusSchema = z.enum(['passed', 'passed_rej', 'in_progress', 'no_pass']);
export type SoQcStageStatus = z.infer<typeof soQcStageStatusSchema>;

// One QC op within a JC for the "QC Stages (in JC)" cell (legacy L18517-18527).
export const soQcStageOpSchema = z.object({
  opSeq: z.number().int(),
  operation: z.string(),
  orderQty: z.number().int().nonnegative(),
  accepted: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  attempts: z.number().int().nonnegative(), // # of QC op_log entries; [Nx] when >1
  status: soQcStageStatusSchema,
});
export type SoQcStageOp = z.infer<typeof soQcStageOpSchema>;

// QC ops grouped by JC (legacy jcQCData / L18515-18529).
export const soQcJcStageSchema = z.object({
  jobCardId: z.string().uuid(),
  jcCode: z.string(),
  ops: z.array(soQcStageOpSchema),
});
export type SoQcJcStage = z.infer<typeof soQcJcStageSchema>;

// Incoming Material QC sub-table row (legacy L18553-18558).
export const soQcGrnDetailSchema = z.object({
  grnNo: z.string(),
  itemCode: z.string().nullable(),
  vendorName: z.string().nullable(),
  receivedQty: z.number().int(),
  accepted: z.number().int(),
  rejected: z.number().int(),
  pending: z.number().int(),
  status: z.enum(['done', 'pending']), // qc_status = 'completed'
});
export type SoQcGrnDetail = z.infer<typeof soQcGrnDetailSchema>;

// TPI sub-table row (legacy L18566-18571).
export const soQcTpiDetailSchema = z.object({
  jcCode: z.string(),
  organization: z.string().nullable(),
  inspector: z.string().nullable(),
  accepted: z.number().int(),
  rejected: z.number().int(),
  date: z.string().nullable(),
  status: z.enum(['passed', 'partial']), // partial when rejected > 0
});
export type SoQcTpiDetail = z.infer<typeof soQcTpiDetailSchema>;

// QC Documents sub-table row (legacy L18579-18584). Every registered doc has a
// file in our model, so status is always "uploaded".
export const soQcDocDetailSchema = z.object({
  jcCode: z.string(),
  docType: z.string(),
  fileName: z.string().nullable(),
  uploaded: z.boolean(),
});
export type SoQcDocDetail = z.infer<typeof soQcDocDetailSchema>;

export const soQcLineSchema = z.object({
  soLineId: z.string().uuid(),
  lineNo: z.number().int(),
  itemCode: z.string().nullable(),
  partName: z.string().nullable(),
  orderQty: z.number().int(),
  jcCount: z.number().int().nonnegative(),
  // True when the line has at least one QC stage of any kind (legacy hasAnyQC).
  hasAnyQc: z.boolean(),
  qcOpsTotal: z.number().int().nonnegative(),
  qcOpsPassed: z.number().int().nonnegative(),
  qcAccepted: z.number().int().nonnegative(),
  qcRejected: z.number().int().nonnegative(),
  qcPending: z.number().int().nonnegative(),
  tpiCount: z.number().int().nonnegative(),
  tpiAccepted: z.number().int().nonnegative(),
  tpiRejected: z.number().int().nonnegative(),
  // GRN-QC (incoming material) — GRN lines attributable to this SO line.
  grnTotal: z.number().int().nonnegative(),
  grnDone: z.number().int().nonnegative(), // qc_status = 'completed'
  grnReceived: z.number().int().nonnegative(),
  grnAccepted: z.number().int().nonnegative(),
  grnRejected: z.number().int().nonnegative(),
  // QC Documents registered against the line's JCs (every row has a file).
  docCount: z.number().int().nonnegative(),
  docUploaded: z.number().int().nonnegative(),
  // Overall completion % across all stage items (legacy overallPct L18477).
  overallPct: z.number().int().min(0).max(100),
  overall: soQcOverallSchema,
  // Rich rendering payloads.
  jcQc: z.array(soQcJcStageSchema), // "QC Stages (in JC)" cell
  grnDetail: z.array(soQcGrnDetailSchema), // expandable Incoming Material QC
  tpiDetail: z.array(soQcTpiDetailSchema), // expandable TPI
  docDetail: z.array(soQcDocDetailSchema), // expandable QC Documents
});
export type SoQcLine = z.infer<typeof soQcLineSchema>;

export interface ListSoForQcResponse {
  sos: SoQcSelector[];
}

export const soQcStatusResponseSchema = z.object({
  so: soQcSelectorSchema,
  lines: z.array(soQcLineSchema),
});
export type SoQcStatusResponse = z.infer<typeof soQcStatusResponseSchema>;
