// JW Return Challan shared schemas (ADR-079 — job-work cycle completion).
//
// Returns machined goods to the customer against a Job Work Order line. Guard:
// qty <= produced (terminal QC-accepted on the line's JC) minus already
// returned; bumps job_work_order_lines.returned_qty. Numbering: IN-JWRC-#####.

import { z } from 'zod';
import { clientCopySchema } from './party-copy';

export const jwReturnChallanSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  code: z.string(),
  status: z.enum(['issued', 'cancelled']), // R10 (ADR-194): fixed to a real enum
  returnDate: z.string(),
  jobWorkOrderId: z.string().uuid(),
  jobWorkOrderLineId: z.string().uuid(),
  jwCodeText: z.string().nullable(),
  jobCardId: z.string().uuid().nullable(),
  clientId: z.string().uuid().nullable(),
  qty: z.number().int().positive(),
  transport: z.string().nullable(),
  vehicleNo: z.string().nullable(),
  remarks: z.string().nullable(),
  // R10 (ADR-194): cancel audit trail (migration 0174).
  cancelledAt: z.string().nullable().default(null),
  cancelledBy: z.string().uuid().nullable().default(null),
  cancelReason: z.string().nullable().default(null),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type JwReturnChallan = z.infer<typeof jwReturnChallanSchema>;

export const jwReturnChallanListItemSchema = jwReturnChallanSchema.extend({
  clientName: z.string().nullable(),
  partName: z.string().nullable(),
  /** For the printed return challan: the JWSO line's item code (live join,
   *  snapshot fallback), the customer's drawing revision, unit, and the
   *  JWSO's Client PO No. */
  itemCode: z.string().nullable().default(null),
  itemRevision: z.string().nullable().default(null),
  uom: z.string().nullable().default(null),
  /** HSN off the item master (items.hsn_code), printed on the challan (A4). */
  hsnCode: z.string().nullable().optional(),
  clientPoNo: z.string().nullable().default(null),
  /** Legal copy of the customer taken when this paper was made (0186, plan
   *  D7). The print reads it; null only on a row made before 0186 (the print
   *  then falls back to the live customer master). */
  clientCopy: clientCopySchema.nullable().default(null),
});
export type JwReturnChallanListItem = z.infer<typeof jwReturnChallanListItemSchema>;

export const createJwReturnChallanInputSchema = z.object({
  code: z.string().trim().max(40).optional(),
  returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  jobWorkOrderLineId: z.string().uuid(),
  jobCardId: z.string().uuid().optional(),
  qty: z.number().int().positive(),
  transport: z.string().trim().max(120).optional(),
  vehicleNo: z.string().trim().max(40).optional(),
  remarks: z.string().trim().max(500).optional(),
});
export type CreateJwReturnChallanInput = z.infer<typeof createJwReturnChallanInputSchema>;

/** R10 (ADR-194): cancel an issued JW Return Challan — reverses returned_qty on
 *  the line so the goods can be returned again, and is blocked while an
 *  uncancelled JW invoice still covers the returned qty. Reuses jw_create. */
export const cancelJwReturnChallanInputSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type CancelJwReturnChallanInput = z.infer<typeof cancelJwReturnChallanInputSchema>;

export const listJwReturnChallansResponseSchema = z.object({
  items: z.array(jwReturnChallanListItemSchema),
  total: z.number().int().nonnegative(),
});
export type ListJwReturnChallansResponse = z.infer<typeof listJwReturnChallansResponseSchema>;

/** List filters for the JW Return Challan register.
 *
 *  These lists had NO query schema at all: the endpoint took no parameters,
 *  returned a hard-capped page and the screen filtered the rows it had been
 *  given in the browser. That works only while a company stays under the cap —
 *  past it, rows the server never sent are invisible to the list AND to its
 *  search, and the search box quietly lies. Moving the match to the server is
 *  what makes the cap safe.
 *
 *  `search` is a single case-insensitive substring, matched across every column
 *  the register displays (see the service). `limit`/`offset` replace the old
 *  fixed cap so the page size is the caller's decision, not a constant buried
 *  in a query. */
export const listJwReturnChallansQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(),
  limit: z.coerce.number().int().positive().max(500).default(200),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListJwReturnChallansQuery = z.infer<typeof listJwReturnChallansQuerySchema>;

/** Per JWSO line: how much can go back to the customer right now — the SAME
 *  limit createJwReturnChallan enforces. Ready = final-QC-accepted qty on the
 *  line's Job Card(s) (assembly lines: complete sets); Returnable =
 *  min(Ready − Returned, Order Qty − Returned), never below 0. */
export const jwReturnableLineSchema = z.object({
  jobWorkOrderLineId: z.string().uuid(),
  readyQty: z.number().int().nonnegative(),
  returnedQty: z.number().int().nonnegative(),
  pendingQty: z.number().int().nonnegative(),
  returnableQty: z.number().int().nonnegative(),
});
export type JwReturnableLine = z.infer<typeof jwReturnableLineSchema>;

export const jwReturnableResponseSchema = z.object({
  lines: z.array(jwReturnableLineSchema),
});
export type JwReturnableResponse = z.infer<typeof jwReturnableResponseSchema>;
