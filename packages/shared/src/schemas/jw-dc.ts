// JW Delivery Challan shared schemas (Store slice 3).
//
// Outward = Returnable Gate Pass when sending material out for job work.
// Inward = receiving processed/returned material back from JW vendor.
// Mirrors legacy renderJWDC (HTML L24434). Numbering: JWDC-OUT-NNNN (outward)
// / JWIN-NNNN (inward, per legacy L24696).

import { z } from 'zod';

import { sfRawParamSchema } from './list-query';

// ─── Outward ───────────────────────────────────────────────────────────────

export const jwDcOutwardLineSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  jwDcOutwardId: z.string().uuid(),
  lineNo: z.number().int().positive(),
  purchaseOrderLineId: z.string().uuid().nullable(),
  itemId: z.string().uuid().nullable(),
  // Live items-master values (LEFT JOIN items on item_id). Null when the line
  // has no item_id or the item was deleted. Prefer these over the *_text
  // snapshots, which can drift from the master.
  itemCode: z.string().nullable(),
  /** The customer's drawing revision off the SO / JWSO line behind this row, so
   *  the code reads CODE/REV like every other screen (ADR-178). Null when no
   *  order line sits behind it; never `items.revision`, a different column. */
  itemRevision: z.string().nullable().default(null),
  /** The customer's PO line number (`POL`) for that same SO line. Null when the
   *  row is job-work sourced or has no sales order behind it. Read-only — the
   *  Sales Order is the only place it is typed (user rule, 2026-09-23). */
  clientPoLineNo: z.string().nullable().default(null),
  itemName: z.string().nullable(),
  itemCodeText: z.string(),
  itemNameText: z.string().nullable(),
  processText: z.string().nullable(),
  poQty: z.number().nonnegative(),
  sentQty: z.number().positive(),
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
  /** ADR-235 — the cancel's reason and time (null while live). */
  cancelReason: z.string().nullable().default(null),
  cancelledAt: z.string().nullable().default(null),
});
export type JwDcOutward = z.infer<typeof jwDcOutwardSchema>;

export const jwDcOutwardListItemSchema = jwDcOutwardSchema.extend({
  /** Live vendors.name by vendorId (plan v3 Step 4) — screens read
   *  `vendorName ?? vendorNameText`; the saved copy stays for the print. */
  vendorName: z.string().nullable().default(null),
  linesCount: z.number().int().nonnegative(),
  totalSentQty: z.number().nonnegative(),
  totalReturnedQty: z.number().nonnegative(),
  pendingQty: z.number().nonnegative(),
  /** out | partial | fully_returned */
  returnStatus: z.enum(['out', 'partial', 'fully_returned']),
  /** SO code(s) resolved via the JWPO's lines (source_so_line_id →
   *  sales_orders). Null when the source JC came from a JWSO, not an SO. */
  soCode: z.string().nullable(),
});
export type JwDcOutwardListItem = z.infer<typeof jwDcOutwardListItemSchema>;

export const jwDcOutwardDetailSchema = jwDcOutwardListItemSchema.extend({
  lines: z.array(
    jwDcOutwardLineSchema.extend({
      alreadyReturned: z.number().nonnegative(),
      pending: z.number().nonnegative(),
      /** Unit from the items master (items.uom) for the printed UOM column.
       *  Null when the line names no item; the print then shows NOS. */
      uom: z.string().nullable().default(null),
    }),
  ),
});
export type JwDcOutwardDetail = z.infer<typeof jwDcOutwardDetailSchema>;

// ─── Outward write inputs ──────────────────────────────────────────────────

export const createJwDcOutwardLineInputSchema = z.object({
  purchaseOrderLineId: z.string().uuid(),
  /** Decimal for KGS / MTR (3 places); NOS / SET stay whole (stock ledger, 0172). */
  sentQty: z.number().positive().multipleOf(0.001),
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
  // Live items-master values (LEFT JOIN items on item_id), mirroring the
  // outward line. Optional because there is currently no inward *detail* read
  // that populates them — inward lines are only surfaced via the outward
  // detail (New Inward modal) and the inward list aggregate. Present here so a
  // future inward detail read can expose them without another schema change.
  itemCode: z.string().nullable().optional(),
  /** The customer's drawing revision off the SO / JWSO line behind this row, so
   *  the code reads CODE/REV like every other screen (ADR-178). Null when no
   *  order line sits behind it; never `items.revision`, a different column. */
  itemRevision: z.string().nullable().default(null),
  /** The customer's PO line number (`POL`) for that same SO line. Null when the
   *  row is job-work sourced or has no sales order behind it. Read-only — the
   *  Sales Order is the only place it is typed (user rule, 2026-09-23). */
  clientPoLineNo: z.string().nullable().default(null),
  itemName: z.string().nullable().optional(),
  itemCodeText: z.string(),
  itemNameText: z.string().nullable(),
  processText: z.string().nullable(),
  sentQty: z.number().nonnegative(),
  receivedQty: z.number().positive(),
  okQty: z.number().nonnegative(),
  rejectedQty: z.number().nonnegative(),
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
  /** ADR-235 — the cancel's reason and time (null while live). */
  cancelReason: z.string().nullable().default(null),
  cancelledAt: z.string().nullable().default(null),
  inwardDate: z.string(),
  jwDcOutwardId: z.string().uuid(),
  dcCodeText: z.string().nullable(),
  vendorChallanNo: z.string().nullable(),
  vehicleNo: z.string().nullable(),
  remarks: z.string().nullable(),
  /** The QC-pending GRN this receipt raised (0172). Null on receipts made
   *  before 0172, which the store accepted itself. */
  goodsReceiptNoteId: z.string().uuid().nullable().default(null),
  /** That GRN's number, joined live — shown so the store can follow it to QC. */
  grnCode: z.string().nullable().default(null),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type JwDcInward = z.infer<typeof jwDcInwardSchema>;

export const jwDcInwardListItemSchema = jwDcInwardSchema.extend({
  vendorNameText: z.string().nullable(),
  /** Live vendors.name via the outward's vendorId; null when it has none. */
  vendorName: z.string().nullable().default(null),
  totalReceivedQty: z.number().nonnegative(),
  totalOkQty: z.number().nonnegative(),
  totalRejectedQty: z.number().nonnegative(),
});
export type JwDcInwardListItem = z.infer<typeof jwDcInwardListItemSchema>;

// ─── Inward write inputs ───────────────────────────────────────────────────

/** The store says only how much came back. Accept / reject is decided at
 *  Incoming QC on the QC-pending GRN the receipt raises (ADR-189 — Incoming QC
 *  is the only inspector, 0172), exactly like DC Receive. */
export const createJwDcInwardLineInputSchema = z.object({
  jwDcOutwardLineId: z.string().uuid(),
  /** Decimal for KGS / MTR (3 places); NOS / SET stay whole (0172). */
  receivedQty: z.number().positive().multipleOf(0.001),
  remarks: z.string().trim().max(500).optional(),
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
  /** Sort & Filter (ADR-200): the screen's column sort + filters, on the server. */
  sf: sfRawParamSchema,
  /** ADR-235 — 'true' adds Cancelled ones (the list screen only; a cancel
   *  stamps deleted_at too, so every other reader keeps live rows alone). */
  includeCancelled: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
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
  /** ADR-235 — 'true' adds Cancelled ones (the list screen only; a cancel
   *  stamps deleted_at too, so every other reader keeps live rows alone). */
  includeCancelled: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  /** Sort & Filter (ADR-200): the screen's column sort + filters, on the server. */
  sf: sfRawParamSchema,
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
  /** The customer's drawing revision off the SO / JWSO line behind this row, so
   *  the code reads CODE/REV like every other screen (ADR-178). Null when no
   *  order line sits behind it; never `items.revision`, a different column. */
  itemRevision: z.string().nullable().default(null),
  /** The customer's PO line number (`POL`) for that same SO line. Null when the
   *  row is job-work sourced or has no sales order behind it. Read-only — the
   *  Sales Order is the only place it is typed (user rule, 2026-09-23). */
  clientPoLineNo: z.string().nullable().default(null),
  itemName: z.string(),
  processText: z.string().nullable(),
  /** Unit from the items master (items.uom), shown beside the quantities.
   *  Null when the line names no item. */
  uom: z.string().nullable().default(null),
  poQty: z.number().nonnegative(),
  /** SENT against the PO line — OSP DCs AND JW DC Outwards together, the one
   *  figure both screens check (lib/po-line-sent.ts). */
  alreadySent: z.number().nonnegative(),
  available: z.number().nonnegative(),
});
export type JwDcPoLine = z.infer<typeof jwDcPoLineSchema>;

export interface JwDcPoLinesResponse {
  purchaseOrderId: string;
  poCodeText: string;
  vendorCodeText: string | null;
  vendorNameText: string | null;
  lines: JwDcPoLine[];
}

// ─── ADR-261 — one row per DC LINE (Outward / Inward Registers) ─────────────
// GET /jw-dc/outward/lines and GET /jw-dc/inward/lines take the SAME query as
// the document lists above and answer the same envelope. Each row is one live
// line of a live challan / receipt (plus, with includeCancelled, the lines
// cancelled with a Cancelled document). The order behind the line is traced
// DC line → PO line → SO line (or Job Card → SO / JWSO line): soCode +
// soInternalNo when it is a Sales Order, jwCode when it is a JWSO, all null
// when no order sits behind it. The document lists themselves are unchanged
// (pickers use them).

const jwDcLeadFields = {
  lineId: z.string().uuid(),
  docId: z.string().uuid(),
  docCode: z.string(),
  docDate: z.string(),
  /** ADR-235 — set on a Cancelled document (its lines are listed with it). */
  cancelReason: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  jwpoCodeText: z.string().nullable(),
  /** Live master name, else the challan's saved name / code. */
  vendorName: z.string().nullable(),
  vehicleNo: z.string().nullable(),
  remarks: z.string().nullable(),
  soCode: z.string().nullable(),
  soInternalNo: z.string().nullable(),
  jwCode: z.string().nullable(),
  clientPoLineNo: z.string().nullable(),
  /** The line's own created_at (ISO timestamp). */
  createdAt: z.string(),
  itemCode: z.string().nullable(),
  /** The customer's drawing revision off the SO / JWSO line behind the row. */
  itemRevision: z.string().nullable(),
  itemName: z.string().nullable(),
  processText: z.string().nullable(),
};

export const jwDcOutwardLineRowSchema = z.object({
  ...jwDcLeadFields,
  vendorId: z.string().uuid().nullable(),
  sentQty: z.number().nonnegative(),
  /** Σ received back on live inward lines against this outward line. */
  receivedQty: z.number().nonnegative(),
  /** Sent − received, never below 0; 0 on a Cancelled challan. */
  pendingQty: z.number().nonnegative(),
  /** This LINE's return state (a Cancelled challan reads 'fully_returned'; the
   *  screen shows Cancelled from cancelledAt). */
  returnStatus: z.enum(['out', 'partial', 'fully_returned']),
});
export type JwDcOutwardLineRow = z.infer<typeof jwDcOutwardLineRowSchema>;

export interface ListJwDcOutwardLinesResponse {
  items: JwDcOutwardLineRow[];
  total: number;
  limit: number;
  offset: number;
}

export const jwDcInwardLineRowSchema = z.object({
  ...jwDcLeadFields,
  jwDcOutwardId: z.string().uuid(),
  /** Our outward DC No. the pieces came back against. */
  dcCodeText: z.string().nullable(),
  vendorChallanNo: z.string().nullable(),
  goodsReceiptNoteId: z.string().uuid().nullable(),
  grnCode: z.string().nullable(),
  receivedQty: z.number().nonnegative(),
  /** Incoming QC on the receipt's GRN line (0172); older receipts their own OK. */
  okQty: z.number().nonnegative(),
  rejectedQty: z.number().nonnegative(),
});
export type JwDcInwardLineRow = z.infer<typeof jwDcInwardLineRowSchema>;

export interface ListJwDcInwardLinesResponse {
  items: JwDcInwardLineRow[];
  total: number;
  limit: number;
  offset: number;
}
