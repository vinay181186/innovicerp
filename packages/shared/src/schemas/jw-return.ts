// JW Return Challan shared schemas (ADR-079 — job-work cycle completion).
//
// Returns machined goods to the customer against a Job Work Order line. Guard:
// qty <= produced (terminal QC-accepted on the line's JC) minus already
// returned; bumps job_work_order_lines.returned_qty. Numbering: IN-JWRC-#####.

import { z } from 'zod';

export const jwReturnChallanSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  code: z.string(),
  status: z.string(), // 'issued' | 'cancelled'
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
