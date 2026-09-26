// JW Invoice shared schemas (ADR-079 — job-work cycle completion).
//
// Bills the labour / processing charge for a Job Work Order line: qty x line
// rate + GST (from the JWSO header). NO material value (the customer owns the
// material). Guard: qty <= returned minus already invoiced; bumps
// job_work_order_lines.invoiced_qty. Numbering: IN-JWINV-#####.

import { z } from 'zod';
import { servicePoTaxTypeSchema } from './service-po';

/** How the GST on a JW invoice splits on paper: 'sgst_cgst' (same state — half
 *  SGST, half CGST) or 'igst' (inter-state). The same two codes the purchase
 *  order and the service PO store, so it reuses that enum rather than naming
 *  the fact twice. Totals do not depend on it: the total GST % is unchanged. */
export const jwInvoiceTaxTypeSchema = servicePoTaxTypeSchema;

export const jwInvoiceSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  code: z.string(),
  invoiceDate: z.string(),
  jobWorkOrderId: z.string().uuid(),
  jobWorkOrderLineId: z.string().uuid(),
  jwCodeText: z.string().nullable(),
  clientId: z.string().uuid().nullable(),
  qty: z.number().int().positive(),
  // Money — NULL when the viewer's access hides prices.
  rate: z.number().nonnegative().nullable(),
  taxableAmount: z.number().nonnegative().nullable(),
  gstPercent: z.number().nonnegative().nullable(),
  gstAmount: z.number().nonnegative().nullable(),
  totalAmount: z.number().nonnegative().nullable(),
  /** Migration 0148. Null on invoices raised before it — those print a single
   *  "GST @ n%" row, as they always did. */
  taxType: jwInvoiceTaxTypeSchema.nullable().default(null),
  remarks: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type JwInvoice = z.infer<typeof jwInvoiceSchema>;

export const jwInvoiceListItemSchema = jwInvoiceSchema.extend({
  clientName: z.string().nullable(),
  /** The item code off the JWSO line, printed as CODE/REV with the revision
   *  below. The printed invoice used to show the part name alone. */
  itemCode: z.string().nullable().default(null),
  /** The customer's drawing revision on that JWSO line. */
  itemRevision: z.string().nullable().default(null),
  /** The customer's PO line number (`POL`) for the SO line behind the JWSO
   *  line, when there is one. */
  clientPoLineNo: z.string().nullable().default(null),
  partName: z.string().nullable(),
  /** Unit of the JWSO line being billed (job_work_order_lines.uom). Null only
   *  when the line cannot be read; the print then falls back to NOS. */
  uom: z.string().nullable().default(null),
});
export type JwInvoiceListItem = z.infer<typeof jwInvoiceListItemSchema>;

export const createJwInvoiceInputSchema = z.object({
  code: z.string().trim().max(40).optional(),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  jobWorkOrderLineId: z.string().uuid(),
  qty: z.number().int().positive(),
  // Optional override; defaults to the JW line's rate when omitted.
  rate: z.number().nonnegative().optional(),
  /** Defaults to 'sgst_cgst' (same-state supply) when omitted. */
  taxType: jwInvoiceTaxTypeSchema.optional(),
  remarks: z.string().trim().max(500).optional(),
});
export type CreateJwInvoiceInput = z.infer<typeof createJwInvoiceInputSchema>;

export const listJwInvoicesResponseSchema = z.object({
  items: z.array(jwInvoiceListItemSchema),
  total: z.number().int().nonnegative(),
  /** Told, not inferred. The server strips money it may not send and states it
   *  here, so a client never has to guess from a null value. A null money field
   *  also means "no value yet", and probing it made one unpriced row hide the
   *  money columns from a user fully entitled to see them. */
  priceVisible: z.boolean(),
});
export type ListJwInvoicesResponse = z.infer<typeof listJwInvoicesResponseSchema>;

/** List filters for the JW Invoice register.
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
export const listJwInvoicesQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(),
  limit: z.coerce.number().int().positive().max(500).default(200),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListJwInvoicesQuery = z.infer<typeof listJwInvoicesQuerySchema>;
