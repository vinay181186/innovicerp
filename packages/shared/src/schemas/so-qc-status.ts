// SO QC Status read shapes (QC Wave 4). Mirrors legacy renderSOQCStatus
// (HTML L18347): per-SO selector -> per-line QC-stage rollup. Read-only over
// job_cards (source_so_line_id) -> v_jc_op_status (QC ops) + op_log (is_tpi).
//
// Cleanly-attributable stages: QC Ops + TPI. GRN-QC + Docs are partial (GRN is
// not attributable per SO line in the normalised model; QC Documents not built)
// — surfaced as informational, see docs/PARITY/qc-so-status.md.

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
