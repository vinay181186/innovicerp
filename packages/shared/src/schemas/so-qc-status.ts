// SO QC Status read shapes (QC Wave 4 + 2026-05-24 GRN-QC/Docs). Mirrors legacy
// renderSOQCStatus (HTML L18347): per-SO selector -> per-line QC-stage rollup.
// All four legacy stages now attributable per SO line:
//   • QC Ops — job_cards.source_so_line_id -> v_jc_op_status
//   • TPI    — op_log.is_tpi on the same JCs
//   • GRN-QC — goods_receipt_note_lines -> purchase_order_lines
//              (source_so_line_id, or source_jc_op_id -> jc_ops -> job_cards)
//   • Docs   — qc_documents.job_card_id -> job_cards.source_so_line_id
// Read-only, no migration. See docs/PARITY/qc-so-status.md.

import { z } from 'zod';

export const soQcSelectorSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  customerName: z.string().nullable(),
  status: z.string(),
  soDate: z.string().nullable(),
});
export type SoQcSelector = z.infer<typeof soQcSelectorSchema>;

export const soQcOverallSchema = z.enum(['none', 'pending', 'in_progress', 'passed']);
export type SoQcOverall = z.infer<typeof soQcOverallSchema>;

export const soQcLineSchema = z.object({
  soLineId: z.string().uuid(),
  lineNo: z.number().int(),
  itemCode: z.string().nullable(),
  partName: z.string().nullable(),
  orderQty: z.number().int(),
  jcCount: z.number().int().nonnegative(),
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
  overall: soQcOverallSchema,
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
