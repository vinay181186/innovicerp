import { z } from 'zod';

// An outsourced operation's link to the purchase order lines that cover it —
// migration 0118, ADR-152 phase 4.
//
// `jc_ops.outsource_po_line_id` is a single column, and it is the join key for
// the whole outsource chain: the outward-DC quantity guard, the receipt cascade
// and the job card's OSP view all match on it. So once a Purchase Request may be
// covered by more than one PO, an outsourced op could only ever follow ONE of
// them — the second PO's challan and receipt would never cascade back and the
// operation would silently never complete, with material at the vendor and no
// error anywhere.
//
// One row per (op, PO line) with the quantity that link carries, so the op's
// outsourced quantity is the SUM of its links rather than an implied whole. Same
// shape as the ADR-081 outsource-balance dual lane — an op split across lanes and
// recombined — applied to purchasing.
//
// `jc_ops.outsource_po_line_id` is deliberately KEPT and still written with the
// FIRST link, exactly as `machines.machine_type` was kept in 0116: every screen
// and cascade that reads it keeps working while callers move across one at a
// time. It stops being the source of truth, not the column.

export const jcOpPoLineSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  jcOpId: z.string().uuid(),
  purchaseOrderLineId: z.string().uuid(),
  /** How much of this operation this particular PO line covers. Always > 0 — a
   *  link that carries nothing is a deleted link, not a zero one. */
  qty: z.number().int().positive(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type JcOpPoLine = z.infer<typeof jcOpPoLineSchema>;

/** What the job-card and op screens actually render: the link plus the readable
 *  purchase order it points at, so a user sees "PO-00008 line 2 — 30 pcs" rather
 *  than a pair of uuids. Assembled by the API's join; never written by a client. */
export const jcOpPoLinkViewSchema = z.object({
  purchaseOrderLineId: z.string().uuid(),
  purchaseOrderId: z.string().uuid(),
  poCode: z.string(),
  poLineNo: z.number().int().positive(),
  /** Null when the viewer's access hides prices, matching every other rate in
   *  the system. */
  rate: z.string().nullable(),
  qty: z.number().int().positive(),
  /** So the screen can grey out a link whose PO was cancelled instead of making
   *  the reader work out why the quantities no longer add up. */
  poStatus: z.string(),
});
export type JcOpPoLinkView = z.infer<typeof jcOpPoLinkViewSchema>;
