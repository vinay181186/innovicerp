// Delivery Challan shared schemas (T-040a — read-only).
//
// Header + lines per ADR-017. T-040a exposes list + detail only — no create
// or edit path yet. The legacy `printChallan` flow (legacy line 26133) creates
// DCs against JW POs with cascade into `jc_ops.sentQty` / outsourceStatus
// transitions; that lands in a future task once the dispatch UX is defined.
//
// Two read shapes:
//   - DeliveryChallan (table row); DeliveryChallanWithLines bundles lines for
//     detail page; DeliveryChallanListItem joins vendor name + po code + line
//     aggregates for the list view.

import { z } from 'zod';
import { DC_STATUSES } from '../enums/dc-status';
import { uomSchema } from './item';

export const dcStatusSchema = z.enum(DC_STATUSES);

// ─── Read shapes ───────────────────────────────────────────────────────────

export const deliveryChallanSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  code: z.string().min(1),
  dcDate: z.string(),
  purchaseOrderId: z.string().uuid().nullable(),
  poCodeText: z.string(),
  vendorId: z.string().uuid().nullable(),
  vendorCodeText: z.string(),
  salesOrderLineId: z.string().uuid().nullable(),
  soRefText: z.string().nullable(),
  transport: z.string().nullable(),
  status: dcStatusSchema,
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type DeliveryChallan = z.infer<typeof deliveryChallanSchema>;

export const deliveryChallanLineSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  deliveryChallanId: z.string().uuid(),
  lineNo: z.number().int().positive(),
  itemId: z.string().uuid().nullable(),
  itemCodeText: z.string(),
  itemNameText: z.string().nullable(),
  qty: z.string(),
  uom: uomSchema,
  materialText: z.string().nullable(),
  dcRemarks: z.string().nullable(),
  purchaseOrderLineId: z.string().uuid().nullable(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type DeliveryChallanLine = z.infer<typeof deliveryChallanLineSchema>;

export const deliveryChallanWithLinesSchema = deliveryChallanSchema.extend({
  vendorName: z.string().nullable(),
  poCode: z.string().nullable(), // resolved from purchase_orders when purchaseOrderId set
  soCode: z.string().nullable(), // resolved through sales_order_lines → sales_orders
  lines: z.array(deliveryChallanLineSchema),
  // T-059b — receipts are included on the detail load so the UI can render
  // the receipt history + cumulative received/rejected aggregates per line.
  receipts: z.array(z.lazy(() => deliveryChallanReceiptSchema)).default([]),
});
export type DeliveryChallanWithLines = z.infer<typeof deliveryChallanWithLinesSchema>;

export const deliveryChallanListItemSchema = deliveryChallanSchema.extend({
  vendorName: z.string().nullable(),
  poCode: z.string().nullable(),
  soCode: z.string().nullable(),
  lineCount: z.number().int().nonnegative(),
  totalQty: z.string(), // sum of lines.qty as numeric string
});
export type DeliveryChallanListItem = z.infer<typeof deliveryChallanListItemSchema>;

// ─── Query filters ─────────────────────────────────────────────────────────

export const listDeliveryChallansQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(), // matches code / po_code_text / vendor name
  status: dcStatusSchema.optional(),
  vendorId: z.string().uuid().optional(),
  purchaseOrderId: z.string().uuid().optional(),
  fromDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  toDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListDeliveryChallansQuery = z.infer<typeof listDeliveryChallansQuerySchema>;

/** Legacy renderDispatchRegister L10756–10770 — 3-tile KPI strip above the
 *  table. totalDispatched = Σ lines.qty across all DCs (matching the filter
 *  set), entryCount = total DC lines, itemCount = COUNT(DISTINCT item). */
export const dispatchSummarySchema = z.object({
  totalDispatched: z.number().nonnegative(),
  entryCount: z.number().int().nonnegative(),
  itemCount: z.number().int().nonnegative(),
});
export type DispatchSummary = z.infer<typeof dispatchSummarySchema>;

export interface ListDeliveryChallansResponse {
  items: DeliveryChallanListItem[];
  total: number;
  limit: number;
  offset: number;
  /** PL-DR-1b — overall totals across all (non-deleted) DCs matching the
   *  filter set. Drives the KPI strip on /delivery-challans. */
  summary: DispatchSummary;
}

// ─── Write shapes (T-059a) ─────────────────────────────────────────────────

export const createDeliveryChallanLineInputSchema = z.object({
  lineNo: z.number().int().positive().optional(),
  // FK when the line item is in the master, else null with itemCodeText as the
  // human identifier (ADR-012 #10) — mirrors the Job-Work PO line this DC copies.
  itemId: z.string().uuid().nullable().optional(),
  itemCodeText: z.string().min(1),
  itemNameText: z.string().nullable().optional(),
  qty: z.number().positive(),
  uom: uomSchema,
  materialText: z.string().nullable().optional(),
  dcRemarks: z.string().nullable().optional(),
  purchaseOrderLineId: z.string().uuid().nullable().optional(),
});
export type CreateDeliveryChallanLineInput = z.infer<typeof createDeliveryChallanLineInputSchema>;

export const createDeliveryChallanInputSchema = z.object({
  header: z.object({
    // Optional — blank means the server auto-generates the next IN-DC-##### code.
    code: z.string().trim().optional(),
    dcDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    purchaseOrderId: z.string().uuid().nullable().optional(),
    poCodeText: z.string().min(1),
    // FK when the vendor is in the master, else null with vendorCodeText as the
    // human identifier (ADR-015) — mirrors the Job-Work PO this DC is issued from.
    vendorId: z.string().uuid().nullable().optional(),
    vendorCodeText: z.string().min(1),
    salesOrderLineId: z.string().uuid().nullable().optional(),
    soRefText: z.string().nullable().optional(),
    transport: z.string().nullable().optional(),
  }),
  lines: z.array(createDeliveryChallanLineInputSchema).min(1),
});
export type CreateDeliveryChallanInput = z.infer<typeof createDeliveryChallanInputSchema>;

// ─── Receipts (T-059b — outsource receive-back) ────────────────────────────

export const deliveryChallanReceiptLineSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  receiptId: z.string().uuid(),
  deliveryChallanLineId: z.string().uuid(),
  receivedQty: z.string(),
  rejectedQty: z.string(),
  rejectReason: z.string().nullable(),
  remarks: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type DeliveryChallanReceiptLine = z.infer<typeof deliveryChallanReceiptLineSchema>;

export const deliveryChallanReceiptSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  deliveryChallanId: z.string().uuid(),
  receiptCode: z.string(),
  receiptDate: z.string(),
  vendorInvoiceText: z.string().nullable(),
  remarks: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
  lines: z.array(deliveryChallanReceiptLineSchema),
});
export type DeliveryChallanReceipt = z.infer<typeof deliveryChallanReceiptSchema>;

// Receipt code is auto-generated by the service from the parent DC code, so
// the input shape is just: which DC, when, optional vendor invoice + remarks,
// plus per-line received + rejected. Reject reason is required by a Zod refine
// whenever rejectedQty > 0 (mirrors the DB CHECK so client UX surfaces the
// error inline rather than failing on insert).

export const createDeliveryChallanReceiptLineInputSchema = z
  .object({
    deliveryChallanLineId: z.string().uuid(),
    receivedQty: z.number().nonnegative(),
    rejectedQty: z.number().nonnegative().default(0),
    rejectReason: z.string().nullable().optional(),
    remarks: z.string().nullable().optional(),
  })
  .refine((v) => v.receivedQty + v.rejectedQty > 0, {
    message: 'receivedQty + rejectedQty must be > 0',
    path: ['receivedQty'],
  })
  .refine((v) => v.rejectedQty === 0 || (v.rejectReason != null && v.rejectReason.length > 0), {
    message: 'rejectReason is required when rejectedQty > 0',
    path: ['rejectReason'],
  });
export type CreateDeliveryChallanReceiptLineInput = z.infer<
  typeof createDeliveryChallanReceiptLineInputSchema
>;

export const createDeliveryChallanReceiptInputSchema = z.object({
  receiptDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  vendorInvoiceText: z.string().nullable().optional(),
  remarks: z.string().nullable().optional(),
  lines: z.array(createDeliveryChallanReceiptLineInputSchema).min(1),
});
export type CreateDeliveryChallanReceiptInput = z.infer<
  typeof createDeliveryChallanReceiptInputSchema
>;

// Receipt-with-lines is the shape returned by the receive endpoint AND
// included in the DC detail load (each DC has 0..N receipts).
export const deliveryChallanReceiptWithLinesSchema = deliveryChallanReceiptSchema;
export type DeliveryChallanReceiptWithLines = z.infer<typeof deliveryChallanReceiptWithLinesSchema>;
