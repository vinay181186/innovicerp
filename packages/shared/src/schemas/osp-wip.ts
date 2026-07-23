// OSP At-Vendor / WIP reconciliation schemas (read-only register).
//
// Backed by the v_osp_wip view (migration 0064). One row per outsource jc_op,
// reconciling every ordered unit into a bucket:
//
//   order_qty = accepted (came back good) + at_vendor (still out) + not_sent
//
// This is the document-derived answer to "how much is physically at the vendor
// / in process" — a quantity that must NOT live inside the finished-stock
// ledger (that conflation is what drove on-hand negative; see SO-517 trace).

import { z } from 'zod';

export const ospWipRowSchema = z.object({
  jcOpId: z.string().uuid(),
  jobCardId: z.string().uuid(),
  jcCode: z.string(),
  opSeq: z.number().int(),
  operation: z.string().nullable(),
  outsourceStatus: z.string().nullable(),
  itemId: z.string().uuid().nullable(),
  itemCode: z.string().nullable(),
  itemName: z.string().nullable(),
  soCode: z.string().nullable(),
  vendorName: z.string().nullable(),
  vendorCode: z.string().nullable(),
  /** Ordered qty on the job card. */
  orderQty: z.number().int(),
  /** Σ sent to the vendor on outward DCs. */
  sentQty: z.number().int(),
  /** Σ returned by the vendor (receipt lines). */
  returnedQty: z.number().int(),
  /** Σ rejected on receipt. */
  rejectedQty: z.number().int(),
  /** returned − rejected, floored at 0 (good pieces back). */
  acceptedQty: z.number().int(),
  /** sent − returned, floored at 0 (still physically at the vendor). */
  atVendorQty: z.number().int(),
  /** order − sent, floored at 0 (not yet even sent out). */
  notSentQty: z.number().int(),
  /** returned − accepted − rejected, floored at 0 (back but incoming-QC pending). */
  inQcQty: z.number().int(),
});
export type OspWipRow = z.infer<typeof ospWipRowSchema>;

export const ospWipSummarySchema = z.object({
  totalOps: z.number().int().nonnegative(),
  opsAtVendor: z.number().int().nonnegative(),
  atVendorQty: z.number().int().nonnegative(),
  notSentQty: z.number().int().nonnegative(),
  sentQty: z.number().int().nonnegative(),
});
export type OspWipSummary = z.infer<typeof ospWipSummarySchema>;

export const listOspWipQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(),
  /** all | at_vendor (still out) | not_sent (unstarted balance) */
  filter: z.enum(['all', 'at_vendor', 'not_sent']).default('at_vendor'),
});
export type ListOspWipQuery = z.infer<typeof listOspWipQuerySchema>;

export const listOspWipResponseSchema = z.object({
  generatedAt: z.string(),
  filter: z.enum(['all', 'at_vendor', 'not_sent']),
  rows: z.array(ospWipRowSchema),
  summary: ospWipSummarySchema,
});
export type ListOspWipResponse = z.infer<typeof listOspWipResponseSchema>;
