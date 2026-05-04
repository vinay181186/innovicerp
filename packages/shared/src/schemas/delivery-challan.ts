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
  vendorId: z.string().uuid(),
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
  itemId: z.string().uuid(),
  itemCodeText: z.string(),
  itemNameText: z.string().nullable(),
  qty: z.string(),
  uom: uomSchema,
  materialText: z.string().nullable(),
  dcRemarks: z.string().nullable(),
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

export interface ListDeliveryChallansResponse {
  items: DeliveryChallanListItem[];
  total: number;
  limit: number;
  offset: number;
}
