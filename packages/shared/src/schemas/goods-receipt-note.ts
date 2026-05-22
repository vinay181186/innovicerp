// Goods Receipt Note shared schemas (T-036c).
//
// Header + lines with inline QC fields per ADR-015 #8 (legacy data co-locates
// them on the GRN line). Mirrors the legacy GRN flow (`legacy/InnovicERP_v82_12
// _3_DataLossFix_29-04-2026.html` — `renderGRN()` line 26444, `addGRN()` line
// 26515) on top of the Phase 5 storage layer (goods_receipt_notes +
// goods_receipt_note_lines, ADR-015).
//
// Key design notes:
//   - Header carries vendor + PO ref. PO line resolution on GRN lines uses
//     the (po_code, item_code) tuple via the migration loader, but in the UI
//     the form pre-populates lines from the selected PO.
//   - Inline QC fields per line: qc_status / qc_accepted_qty / qc_rejected_qty
//     / qc_date / qc_remarks. CHECK constraint on the table:
//       qc_accepted_qty + qc_rejected_qty <= received_qty
//   - Once a GRN line is qc_status='completed', its QC fields LOCK (form
//     disable + service rejects updates). Reason: the QC-completed transition
//     writes a store_transactions ledger row, and reversing that needs a
//     manual adjust txn (out of T-036c scope). To "undo" a wrong accept,
//     create a reversing GRN line.
//
// Three cascades fire on GRN write (all in the same DB transaction as the
// GRN write itself — handled in the service layer, not via DB triggers):
//   1. recalcPoLineReceivedQty(po_line_id) — sum of GRN-line received_qty
//      across non-deleted GRN lines for that PO line.
//   2. recalcPoHeaderStatus(po_id) — closed/qc_pending/partial/open based on
//      aggregate state of PO lines + their GRN lines.
//   3. writeStoreTxnOnQcAccept(grn_line) — when qc_status flips to
//      'completed' AND qc_accepted_qty > 0, INSERT a store_transactions row
//      of type='in', source='grn_qc'. stock_before/after computed from
//      v_item_stock under an item-row FOR UPDATE lock.

import { z } from 'zod';
import { GRN_QC_STATUSES } from '../enums/grn-qc-status';

export const grnQcStatusSchema = z.enum(GRN_QC_STATUSES);

const codeRegex = /^[A-Za-z0-9._/-]+$/;

// ─── Read shapes ───────────────────────────────────────────────────────────

export const goodsReceiptNoteLineSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  goodsReceiptNoteId: z.string().uuid(),
  lineNo: z.number().int().positive(),
  purchaseOrderLineId: z.string().uuid().nullable(),
  itemId: z.string().uuid().nullable(),
  itemCodeText: z.string().nullable(),
  itemName: z.string(),
  receivedQty: z.number().int().nonnegative(),
  dcRefNo: z.string().nullable(),
  qcStatus: grnQcStatusSchema,
  qcAcceptedQty: z.number().int().nonnegative(),
  qcRejectedQty: z.number().int().nonnegative(),
  qcDate: z.string().nullable(),
  qcRemarks: z.string().nullable(),
  qcInspectedBy: z.string().uuid().nullable(),
  remarks: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type GoodsReceiptNoteLine = z.infer<typeof goodsReceiptNoteLineSchema>;

export const goodsReceiptNoteSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  code: z.string().min(1),
  grnDate: z.string(),
  purchaseOrderId: z.string().uuid().nullable(),
  poCodeText: z.string().nullable(),
  vendorId: z.string().uuid().nullable(),
  vendorCodeText: z.string().nullable(),
  dcNo: z.string().nullable(),
  invoiceNo: z.string().nullable(),
  remarks: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type GoodsReceiptNote = z.infer<typeof goodsReceiptNoteSchema>;

export const goodsReceiptNoteDetailSchema = goodsReceiptNoteSchema.extend({
  lines: z.array(goodsReceiptNoteLineSchema),
});
export type GoodsReceiptNoteDetail = z.infer<typeof goodsReceiptNoteDetailSchema>;

/** List row: header + line aggregates + vendor/PO joins. */
export const goodsReceiptNoteListItemSchema = goodsReceiptNoteSchema.extend({
  vendorName: z.string().nullable(),
  poCode: z.string().nullable(),
  lineCount: z.number().int().nonnegative(),
  totalReceivedQty: z.number().int().nonnegative(),
  /** Σ qcAcceptedQty across lines. Legacy renderGRN L26468 column. */
  totalQcAcceptedQty: z.number().int().nonnegative(),
  /** Σ qcRejectedQty across lines. Legacy renderGRN L26469 column. */
  totalQcRejectedQty: z.number().int().nonnegative(),
  qcPendingCount: z.number().int().nonnegative(),
});
export type GoodsReceiptNoteListItem = z.infer<typeof goodsReceiptNoteListItemSchema>;

// ─── Write inputs ──────────────────────────────────────────────────────────

export const goodsReceiptNoteLineInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    lineNo: z.number().int().positive().optional(),
    purchaseOrderLineId: z.string().uuid().optional(),
    itemId: z.string().uuid().optional(),
    itemCodeText: z.string().min(1).max(64).optional(),
    itemName: z.string().min(1).max(255),
    receivedQty: z.number().int().nonnegative(),
    dcRefNo: z.string().max(64).optional(),
    qcStatus: grnQcStatusSchema.default('pending'),
    qcAcceptedQty: z.number().int().nonnegative().default(0),
    qcRejectedQty: z.number().int().nonnegative().default(0),
    qcDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'qcDate must be YYYY-MM-DD')
      .optional(),
    qcRemarks: z.string().max(2000).optional(),
    remarks: z.string().max(2000).optional(),
  })
  .refine((l) => Boolean(l.itemId) || Boolean(l.itemCodeText?.trim()), {
    message: 'itemId or itemCodeText is required (per ADR-012 #10)',
  })
  .refine((l) => l.qcAcceptedQty + l.qcRejectedQty <= l.receivedQty, {
    message: 'qcAcceptedQty + qcRejectedQty cannot exceed receivedQty',
  });
export type GoodsReceiptNoteLineInput = z.infer<typeof goodsReceiptNoteLineInputSchema>;

const _grnHeaderInputBase = z.object({
  code: z
    .string()
    .min(1)
    .max(64)
    .regex(codeRegex, 'code may contain only letters, digits, dot, slash, underscore, hyphen'),
  grnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'grnDate must be YYYY-MM-DD'),
  purchaseOrderId: z.string().uuid().optional(),
  poCodeText: z.string().max(64).optional(),
  vendorId: z.string().uuid().optional(),
  vendorCodeText: z.string().max(64).optional(),
  dcNo: z.string().max(64).optional(),
  invoiceNo: z.string().max(64).optional(),
  remarks: z.string().max(2000).optional(),
});

/** CREATE — `{header, lines}`. ≥ 1 line; service runs both in tx. */
export const createGoodsReceiptNoteInputSchema = z.object({
  header: _grnHeaderInputBase,
  lines: z.array(goodsReceiptNoteLineInputSchema).min(1, 'At least one line is required'),
});
export type CreateGoodsReceiptNoteInput = z.infer<typeof createGoodsReceiptNoteInputSchema>;

/** UPDATE — same shape; lines optional (option C merge). `code` immutable.
 *  Lines whose existing qc_status is already 'completed' will be rejected
 *  by the service if the input attempts to change their QC fields. */
export const updateGoodsReceiptNoteInputSchema = z.object({
  header: _grnHeaderInputBase.partial().omit({ code: true }),
  lines: z.array(goodsReceiptNoteLineInputSchema).optional(),
});
export type UpdateGoodsReceiptNoteInput = z.infer<typeof updateGoodsReceiptNoteInputSchema>;

// ─── Query filters ─────────────────────────────────────────────────────────

export const listGoodsReceiptNotesQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(),
  vendorId: z.string().uuid().optional(),
  purchaseOrderId: z.string().uuid().optional(),
  /** Filter to GRNs with at least one line in this QC status. */
  qcStatus: grnQcStatusSchema.optional(),
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
export type ListGoodsReceiptNotesQuery = z.infer<typeof listGoodsReceiptNotesQuerySchema>;

/** PL-GRN-1b — 4-tile stat strip data. Mirrors legacy renderGRN L26483–26488:
 *  Total / QC Pending / QC Cleared / Today. Pending counts GRN docs with
 *  any line still in pending or partial QC status. */
export const grnSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  qcPending: z.number().int().nonnegative(),
  qcCleared: z.number().int().nonnegative(),
  today: z.number().int().nonnegative(),
});
export type GrnSummary = z.infer<typeof grnSummarySchema>;

export interface ListGoodsReceiptNotesResponse {
  items: GoodsReceiptNoteListItem[];
  total: number;
  limit: number;
  offset: number;
  /** PL-GRN-1b — KPI strip totals across all (non-deleted) GRNs in the
   *  filter set. */
  summary: GrnSummary;
}
