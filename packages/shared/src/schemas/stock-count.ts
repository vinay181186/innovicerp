// Stock Count (ADR-193 phase 2) — opening stock and periodic physical counts
// (ERPNext Stock Reconciliation). Draft → Submitted → Posted | Cancelled.
// Submit snapshots each line's system qty; approve (a different user) posts
// counted − snapshot, so movements made after the count stay real.

import { z } from 'zod';
import { sfRawParamSchema } from './list-query';

export const STOCK_COUNT_PURPOSES = ['opening', 'periodic'] as const;
export type StockCountPurpose = (typeof STOCK_COUNT_PURPOSES)[number];
export const STOCK_COUNT_PURPOSE_LABELS: Record<StockCountPurpose, string> = {
  opening: 'Opening Stock',
  periodic: 'Periodic Count',
};

export const STOCK_COUNT_STATUSES = ['draft', 'submitted', 'posted', 'cancelled'] as const;
export type StockCountStatus = (typeof STOCK_COUNT_STATUSES)[number];
export const STOCK_COUNT_STATUS_LABELS: Record<StockCountStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  posted: 'Posted',
  cancelled: 'Cancelled',
};

export const STOCK_COUNT_REASON_MIN = 10;
const qty = z.number().nonnegative('Counted Qty cannot be negative').multipleOf(0.001);

export const stockCountLineInputSchema = z.object({
  itemId: z.string().uuid(),
  countedQty: qty,
  reason: z.string().trim().max(255).optional(),
});
export type StockCountLineInput = z.infer<typeof stockCountLineInputSchema>;

const lines = z
  .array(stockCountLineInputSchema)
  .min(1, 'Add at least one item')
  .max(2000)
  .refine((ls) => new Set(ls.map((l) => l.itemId)).size === ls.length, {
    message: 'An item is listed twice — keep one line per item',
  });

export const createStockCountInputSchema = z.object({
  countDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  purpose: z.enum(STOCK_COUNT_PURPOSES),
  remarks: z.string().trim().max(500).optional(),
  lines,
});
export type CreateStockCountInput = z.infer<typeof createStockCountInputSchema>;

export const replaceStockCountLinesInputSchema = z.object({
  remarks: z.string().trim().max(500).optional(),
  lines,
});
export type ReplaceStockCountLinesInput = z.infer<typeof replaceStockCountLinesInputSchema>;

export const approveStockCountInputSchema = z.object({
  /** Needed only when the post would leave less on the shelf than is booked
   *  for customer SOs (the server answers 409 with the bookings first). */
  confirmReason: z.string().trim().min(STOCK_COUNT_REASON_MIN).max(500).optional(),
});
export type ApproveStockCountInput = z.infer<typeof approveStockCountInputSchema>;

export const cancelStockCountInputSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(STOCK_COUNT_REASON_MIN, `Give a reason (at least ${STOCK_COUNT_REASON_MIN} characters)`)
    .max(500),
});
export type CancelStockCountInput = z.infer<typeof cancelStockCountInputSchema>;

export const listStockCountsQuerySchema = z.object({
  status: z.enum(STOCK_COUNT_STATUSES).optional(),
  search: z.string().trim().max(100).optional(),
  /** Sort & Filter (ADR-200): JSON sort + column filters, see list-query.ts. */
  sf: sfRawParamSchema,
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListStockCountsQuery = z.infer<typeof listStockCountsQuerySchema>;

export const resolveStockCountItemsInputSchema = z.object({
  codes: z.array(z.string().trim().min(1).max(64)).min(1).max(2000),
});
export type ResolveStockCountItemsInput = z.infer<typeof resolveStockCountItemsInputSchema>;
export interface ResolveStockCountItemsResponse {
  /** inStock = physical stock right now (so a new line shows In Stock / Difference at once). */
  found: Array<{ code: string; itemId: string; name: string; uom: string; inStock: number }>;
  missing: string[];
}

export interface StockCountLine {
  id: string;
  lineNo: number;
  itemId: string;
  itemCode: string;
  itemName: string | null;
  uom: string | null;
  countedQty: number;
  /** Snapshot taken on Submit; null while draft. */
  systemQtyAtCount: number | null;
  /** In Stock right now (for comparison on screen). */
  systemQtyNow: number;
  /** counted − snapshot once submitted; counted − now while draft (preview). */
  difference: number;
  reason: string | null;
  storeTransactionId: string | null;
}

export interface StockCount {
  id: string;
  code: string;
  countDate: string;
  purpose: StockCountPurpose;
  status: StockCountStatus;
  remarks: string | null;
  createdAt: string;
  createdBy: string;
  createdByName: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  approvalReason: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  lineCount: number;
  /** Users who created, keyed or submitted the count — none of them may approve it. */
  blockedApproverIds: string[];
  lines?: StockCountLine[];
}

export interface ListStockCountsResponse {
  items: StockCount[];
  total: number;
  limit: number;
  offset: number;
}
