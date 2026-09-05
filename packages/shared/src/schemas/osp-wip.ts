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
  /** How many pieces can go to the vendor RIGHT NOW (0110).
   *
   *  `notSentQty` above is an ORDER-level figure (order − sent) and over-states
   *  what can ship: JC-8 op 8 read "not sent 70" while op 7 had cleared only 30,
   *  all of which were already at the vendor. This is the shop-floor figure —
   *  upstream cleared − done in-house − already sent — mirroring the guard in
   *  delivery-challans/cascades.ts, so the register shows the number the
   *  challan will actually accept. Keep both: one plans the vendor's week, this
   *  one says what may leave today. */
  readyToSendQty: z.number().int(),
});
export type OspWipRow = z.infer<typeof ospWipRowSchema>;

export const ospWipSummarySchema = z.object({
  totalOps: z.number().int().nonnegative(),
  opsAtVendor: z.number().int().nonnegative(),
  atVendorQty: z.number().int().nonnegative(),
  notSentQty: z.number().int().nonnegative(),
  sentQty: z.number().int().nonnegative(),
  /** Σ readyToSendQty across the register — pieces waiting to be sent today. */
  readyToSendQty: z.number().int().nonnegative(),
});
export type OspWipSummary = z.infer<typeof ospWipSummarySchema>;

export const listOspWipQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(),
  /** all | at_vendor (still out) | not_sent (unstarted order balance)
   *  | ready_to_send (cleared upstream and waiting to go out today) */
  filter: z.enum(['all', 'at_vendor', 'not_sent', 'ready_to_send']).default('at_vendor'),
});
export type ListOspWipQuery = z.infer<typeof listOspWipQuerySchema>;

export const listOspWipResponseSchema = z.object({
  generatedAt: z.string(),
  // Echoes the query's filter back, so it must carry the same four values.
  filter: z.enum(['all', 'at_vendor', 'not_sent', 'ready_to_send']),
  rows: z.array(ospWipRowSchema),
  summary: ospWipSummarySchema,
});
export type ListOspWipResponse = z.infer<typeof listOspWipResponseSchema>;
