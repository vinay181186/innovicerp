// JW Delivery Challan shared schemas (Store slice 3).
//
// Outward = Returnable Gate Pass when sending material out for job work.
// Inward = receiving processed/returned material back from JW vendor.
// Mirrors legacy renderJWDC (HTML L24434). Numbering: JWDC-OUT-NNNN (outward)
// / JWIN-NNNN (inward, per legacy L24696).

import { z } from 'zod';

// ─── Outward ───────────────────────────────────────────────────────────────

export const jwDcOutwardLineSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  jwDcOutwardId: z.string().uuid(),
  lineNo: z.number().int().positive(),
  purchaseOrderLineId: z.string().uuid().nullable(),
  itemId: z.string().uuid().nullable(),
  itemCodeText: z.string(),
  itemNameText: z.string().nullable(),
  processText: z.string().nullable(),
  poQty: z.number().int().nonnegative(),
  sentQty: z.number().int().positive(),
  storeTransactionId: z.string().uuid().nullable(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type JwDcOutwardLine = z.infer<typeof jwDcOutwardLineSchema>;

export const jwDcOutwardSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  code: z.string(),
  dcDate: z.string(),
  purchaseOrderId: z.string().uuid().nullable(),
  jwpoCodeText: z.string().nullable(),
  vendorId: z.string().uuid().nullable(),
  vendorCodeText: z.string().nullable(),
  vendorNameText: z.string().nullable(),
  vehicleNo: z.string().nullable(),
  remarks: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type JwDcOutward = z.infer<typeof jwDcOutwardSchema>;

export const jwDcOutwardListItemSchema = jwDcOutwardSchema.extend({
  linesCount: z.number().int().nonnegative(),
  totalSentQty: z.number().int().nonnegative(),
  totalReturnedQty: z.number().int().nonnegative(),
  pendingQty: z.number().int().nonnegative(),
  /** out | partial | fully_returned */
  returnStatus: z.enum(['out', 'partial', 'fully_returned']),
});
export type JwDcOutwardListItem = z.infer<typeof jwDcOutwardListItemSchema>;

export const jwDcOutwardDetailSchema = jwDcOutwardListItemSchema.extend({
  lines: z.array(
    jwDcOutwardLineSchema.extend({
      alreadyReturned: z.number().int().nonnegative(),
      pending: z.number().int().nonnegative(),
    }),
  ),
});
export type JwDcOutwardDetail = z.infer<typeof jwDcOutwardDetailSchema>;

// ─── Outward write inputs ──────────────────────────────────────────────────

export const createJwDcOutwardLineInputSchema = z.object({
  purchaseOrderLineId: z.string().uuid(),
  sentQty: z.number().int().positive(),
});
export type CreateJwDcOutwardLineInput = z.infer<typeof createJwDcOutwardLineInputSchema>;

export const createJwDcOutwardInputSchema = z.object({
  dcDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  purchaseOrderId: z.string().uuid(),
  vehicleNo: z.string().trim().max(64).optional(),
  remarks: z.string().trim().max(500).optional(),
  lines: z.array(createJwDcOutwardLineInputSchema).min(1),
});
export type CreateJwDcOutwardInput = z.infer<typeof createJwDcOutwardInputSchema>;

// ─── Inward ────────────────────────────────────────────────────────────────

export const jwDcInwardLineSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  jwDcInwardId: z.string().uuid(),
  jwDcOutwardLineId: z.string().uuid(),
  itemId: z.string().uuid().nullable(),
  itemCodeText: z.string(),
  itemNameText: z.string().nullable(),
  processText: z.string().nullable(),
  sentQty: z.number().int().nonnegative(),
  receivedQty: z.number().int().positive(),
  okQty: z.number().int().nonnegative(),
  rejectedQty: z.number().int().nonnegative(),
  remarks: z.string().nullable(),
  storeTransactionId: z.string().uuid().nullable(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type JwDcInwardLine = z.infer<typeof jwDcInwardLineSchema>;

export const jwDcInwardSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  code: z.string(),
  inwardDate: z.string(),
  jwDcOutwardId: z.string().uuid(),
  dcCodeText: z.string().nullable(),
  vendorChallanNo: z.string().nullable(),
  vehicleNo: z.string().nullable(),
  remarks: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type JwDcInward = z.infer<typeof jwDcInwardSchema>;

export const jwDcInwardListItemSchema = jwDcInwardSchema.extend({
  vendorNameText: z.string().nullable(),
  totalReceivedQty: z.number().int().nonnegative(),
  totalOkQty: z.number().int().nonnegative(),
  totalRejectedQty: z.number().int().nonnegative(),
});
export type JwDcInwardListItem = z.infer<typeof jwDcInwardListItemSchema>;

// ─── Inward write inputs ───────────────────────────────────────────────────

export const createJwDcInwardLineInputSchema = z.object({
  jwDcOutwardLineId: z.string().uuid(),
  receivedQty: z.number().int().positive(),
  okQty: z.number().int().nonnegative(),
  rejectedQty: z.number().int().nonnegative(),
  remarks: z.string().trim().max(500).optional(),
}).refine((v) => v.okQty + v.rejectedQty === v.receivedQty, {
  message: 'OK + Rejected must equal Received',
});
export type CreateJwDcInwardLineInput = z.infer<typeof createJwDcInwardLineInputSchema>;

export const createJwDcInwardInputSchema = z.object({
  inwardDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  jwDcOutwardId: z.string().uuid(),
  vendorChallanNo: z.string().trim().max(64).optional(),
  vehicleNo: z.string().trim().max(64).optional(),
  remarks: z.string().trim().max(500).optional(),
  lines: z.array(createJwDcInwardLineInputSchema).min(1),
});
export type CreateJwDcInwardInput = z.infer<typeof createJwDcInwardInputSchema>;

// ─── Query filters ─────────────────────────────────────────────────────────

export const listJwDcOutwardQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(),
  vendorId: z.string().uuid().optional(),
  purchaseOrderId: z.string().uuid().optional(),
  returnStatus: z.enum(['out', 'partial', 'fully_returned']).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListJwDcOutwardQuery = z.infer<typeof listJwDcOutwardQuerySchema>;

export interface ListJwDcOutwardResponse {
  items: JwDcOutwardListItem[];
  total: number;
  limit: number;
  offset: number;
}

export const listJwDcInwardQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(),
  jwDcOutwardId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListJwDcInwardQuery = z.infer<typeof listJwDcInwardQuerySchema>;

export interface ListJwDcInwardResponse {
  items: JwDcInwardListItem[];
  total: number;
  limit: number;
  offset: number;
}

// ─── Outward PO line loader (drives "New Outward DC" modal) ──────────────

export const jwDcPoLineSchema = z.object({
  purchaseOrderLineId: z.string().uuid(),
  itemId: z.string().uuid().nullable(),
  itemCode: z.string(),
  itemName: z.string(),
  processText: z.string().nullable(),
  poQty: z.number().int().nonnegative(),
  alreadySent: z.number().int().nonnegative(),
  available: z.number().int().nonnegative(),
});
export type JwDcPoLine = z.infer<typeof jwDcPoLineSchema>;

export interface JwDcPoLinesResponse {
  purchaseOrderId: string;
  poCodeText: string;
  vendorCodeText: string | null;
  vendorNameText: string | null;
  lines: JwDcPoLine[];
}
