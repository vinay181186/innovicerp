// JW Invoice shared schemas (ADR-079 — job-work cycle completion).
//
// Bills the labour / processing charge for a Job Work Order line: qty x line
// rate + GST (from the JWSO header). NO material value (the customer owns the
// material). Guard: qty <= returned minus already invoiced; bumps
// job_work_order_lines.invoiced_qty. Numbering: IN-JWINV-#####.

import { z } from 'zod';

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
  partName: z.string().nullable(),
});
export type JwInvoiceListItem = z.infer<typeof jwInvoiceListItemSchema>;

export const createJwInvoiceInputSchema = z.object({
  code: z.string().trim().max(40).optional(),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  jobWorkOrderLineId: z.string().uuid(),
  qty: z.number().int().positive(),
  // Optional override; defaults to the JW line's rate when omitted.
  rate: z.number().nonnegative().optional(),
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
