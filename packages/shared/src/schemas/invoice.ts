// Invoice shared schemas (migration 0050). Full tax-invoice with payment
// tracking. Create is gated on dispatched − invoiced qty per SO line. Mirror of
// legacy renderInvoices / _createInvoice / _addPayment / _printInvoice.

import { z } from 'zod';
import { INVOICE_STATUSES } from '../enums/invoice-status';

// An invoiceable SO line for a chosen SO (the create form).
export const invoiceableLineSchema = z.object({
  salesOrderLineId: z.string().uuid(),
  lineNo: z.number().int(),
  itemCode: z.string().nullable(),
  itemName: z.string(),
  orderQty: z.number().int().nonnegative(),
  dispatchedQty: z.number().int().nonnegative(),
  invoicedQty: z.number().int().nonnegative(),
  availableQty: z.number().int().nonnegative(), // dispatched − invoiced
  rate: z.number().nonnegative(),
});
export type InvoiceableLine = z.infer<typeof invoiceableLineSchema>;

export const invoiceableSoResponseSchema = z.object({
  salesOrderId: z.string().uuid(),
  soCode: z.string(),
  customer: z.string().nullable(),
  clientGst: z.string().nullable(),
  lines: z.array(invoiceableLineSchema),
});
export type InvoiceableSoResponse = z.infer<typeof invoiceableSoResponseSchema>;

export const createInvoiceInputSchema = z.object({
  salesOrderId: z.string().uuid(),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  paymentTermsDays: z.coerce.number().int().nonnegative().default(45),
  gstPercent: z.coerce.number().nonnegative().max(100).default(18),
  remarks: z.string().max(1000).optional(),
  lines: z
    .array(
      z.object({
        salesOrderLineId: z.string().uuid(),
        qty: z.coerce.number().int().positive(),
        rate: z.coerce.number().nonnegative(),
      }),
    )
    .min(1, 'At least one line with qty > 0 is required'),
});
export type CreateInvoiceInput = z.infer<typeof createInvoiceInputSchema>;

export const addPaymentInputSchema = z.object({
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.coerce.number().positive(),
  mode: z.string().max(32).default('NEFT'),
  refNo: z.string().max(128).optional(),
  notes: z.string().max(500).optional(),
});
export type AddPaymentInput = z.infer<typeof addPaymentInputSchema>;

export const invoiceLineRowSchema = z.object({
  id: z.string().uuid(),
  lineNo: z.number().int(),
  // Resolved from the live items master (LEFT JOIN); null when unlinked/deleted.
  itemCode: z.string().nullable(),
  // Stored snapshot fallback captured at invoice creation.
  itemCodeText: z.string().nullable(),
  itemName: z.string(),
  qty: z.number().int(),
  rate: z.number().nonnegative(),
  lineAmount: z.number().nonnegative(),
});
export type InvoiceLineRow = z.infer<typeof invoiceLineRowSchema>;

export const invoicePaymentRowSchema = z.object({
  id: z.string().uuid(),
  paymentDate: z.string(),
  amount: z.number().nonnegative(),
  mode: z.string(),
  refNo: z.string().nullable(),
  notes: z.string().nullable(),
});
export type InvoicePaymentRow = z.infer<typeof invoicePaymentRowSchema>;

export const invoiceRowSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  invoiceDate: z.string(),
  salesOrderId: z.string().uuid(),
  soCode: z.string().nullable(),
  clientName: z.string().nullable(),
  subtotal: z.number().nonnegative(),
  gstPercent: z.number().nonnegative(),
  gstAmount: z.number().nonnegative(),
  grandTotal: z.number().nonnegative(),
  totalPaid: z.number().nonnegative(),
  balance: z.number(),
  status: z.enum(INVOICE_STATUSES),
  dueDate: z.string().nullable(),
  overdue: z.boolean(),
});
export type InvoiceRow = z.infer<typeof invoiceRowSchema>;

export const invoiceDetailSchema = invoiceRowSchema.extend({
  clientCode: z.string().nullable(),
  clientGst: z.string().nullable(),
  paymentTermsDays: z.number().int().nonnegative(),
  remarks: z.string().nullable(),
  lines: z.array(invoiceLineRowSchema),
  payments: z.array(invoicePaymentRowSchema),
});
export type InvoiceDetail = z.infer<typeof invoiceDetailSchema>;

export const listInvoicesResponseSchema = z.object({
  invoices: z.array(invoiceRowSchema),
  summary: z.object({
    totalInvoiced: z.number(),
    totalReceived: z.number(),
    outstanding: z.number(),
    overdueAmount: z.number(),
    overdueCount: z.number().int().nonnegative(),
    unpaidCount: z.number().int().nonnegative(),
    partialCount: z.number().int().nonnegative(),
    paidCount: z.number().int().nonnegative(),
  }),
});
export type ListInvoicesResponse = z.infer<typeof listInvoicesResponseSchema>;
