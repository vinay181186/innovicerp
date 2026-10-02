// Store / Inventory shared schemas (PL-SI-1).
//
// Per-item current-state rollup. Mirrors legacy renderStore (HTML L24803).
// Each row carries: in_stock, min_qty, on_po (open PO pending), mfg_pending
// (open JC pending qty), + belowReorder (ADR-193 phase 5: Available + On PO < Reorder Level).

import { z } from 'zod';
import { sfRawParamSchema } from './list-query';

export const storeInventoryRowSchema = z.object({
  itemId: z.string().uuid(),
  itemCode: z.string(),
  itemName: z.string(),
  material: z.string().nullable(),
  uom: z.string(),
  /** PHYSICAL stock — what is on the shelf, reserved or not (ADR-180).
   *  Unchanged meaning: it has always been item_stock_balances.on_hand_qty. */
  inStock: z.number(),
  /** Σ of what every active reservation still holds for this item. */
  reservedQty: z.number().nonnegative(),
  /** inStock − reservedQty. What a new order may still be promised. */
  availableQty: z.number(),
  /** ADR-193 phase 5 — Reorder Level (was Min Qty; items.min_stock_qty). */
  reorderLevel: z.number().nonnegative(),
  /** How much one reorder buys (items.reorder_qty). 0 = buy the shortfall. */
  reorderQty: z.number().nonnegative(),
  /** Σ pending qty on open POs (qty − received). */
  onPoQty: z.number().nonnegative(),
  /**
   * Σ qty physically out at an OSP vendor (v_osp_wip.at_vendor_qty), i.e. sent
   * on an outward DC and not yet returned. NOT part of inStock — with no BOM
   * these pieces carry the same item code, so without this column a row reads
   * "in stock 5" with no hint that another 5 are sitting at a vendor.
   */
  atVendorQty: z.number().nonnegative(),
  /** Σ pending qty on open JCs (order_qty − completed). */
  mfgPendingQty: z.number().nonnegative(),
  /** Below Reorder: reorderLevel > 0 AND availableQty + onPoQty < reorderLevel. */
  belowReorder: z.boolean(),
});
export type StoreInventoryRow = z.infer<typeof storeInventoryRowSchema>;

/** 4-tile KPI strip data — legacy renderStore L24876–24891. */
export const storeInventorySummarySchema = z.object({
  totalItems: z.number().int().nonnegative(),
  totalStockPieces: z.number().nonnegative(),
  /** Pieces held by active reservations across every item. */
  totalReservedPieces: z.number().nonnegative(),
  /** totalStockPieces − totalReservedPieces. */
  totalAvailablePieces: z.number().nonnegative(),
  itemsInStockCount: z.number().int().nonnegative(),
  /** Items Below Reorder. */
  belowReorderCount: z.number().int().nonnegative(),
  zeroStockCount: z.number().int().nonnegative(),
});
export type StoreInventorySummary = z.infer<typeof storeInventorySummarySchema>;

export const listStoreInventoryQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(),
  /** all | below (Below Reorder) | zero */
  filter: z.enum(['all', 'below', 'zero']).default('all'),
  /** Sort & Filter (ADR-200): JSON sort + column filters, see list-query.ts. */
  sf: sfRawParamSchema,
  /** Paging (ADR-201). No limit = every matching row (as before). */
  limit: z.coerce.number().int().positive().max(1000).optional(),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListStoreInventoryQuery = z.infer<typeof listStoreInventoryQuerySchema>;

export const listStoreInventoryResponseSchema = z.object({
  generatedAt: z.string(),
  filter: z.enum(['all', 'below', 'zero']),
  rows: z.array(storeInventoryRowSchema),
  /** Every item matching search + filter + Sort & Filter (all pages). */
  total: z.number().int().nonnegative(),
  /** Tile figures over every item matching search + Sort & Filter (not the filter). */
  summary: storeInventorySummarySchema,
});
export type ListStoreInventoryResponse = z.infer<typeof listStoreInventoryResponseSchema>;

// ─── Write inputs ─────────────────────────────────────────────────────────

/** Where a Manual Receipt's stock came from. 'purchase' is listed only so the
 *  server can refuse it with a clear message — bought material is received
 *  through a GRN against its PO (store-manual-receipt#2), never here. */
export const manualReceiptSourceSchema = z.enum(['production', 'return', 'other', 'purchase']);
export type ManualReceiptSource = z.infer<typeof manualReceiptSourceSchema>;
export const MANUAL_RECEIPT_SOURCE_LABEL: Record<ManualReceiptSource, string> = {
  production: 'Production',
  return: 'Return',
  other: 'Other',
  purchase: 'Purchase',
};

/** Manual stock adjustment (+ Add / − Remove). Writes a store_transactions row. */
export const adjustStockInputSchema = z.object({
  itemId: z.string().uuid(),
  direction: z.enum(['add', 'remove']),
  // ADR-193: decimal for KGS / MTR items; whole-number units are enforced by
  // the stock writer (lib/stock-ledger.ts) against the item's UOM.
  qty: z.number().positive().multipleOf(0.001),
  remarks: z.string().trim().min(1).max(255),
  /** Manual Receipt only: where the stock came from. Remarks stay free text. */
  source: manualReceiptSourceSchema.optional(),
});
export type AdjustStockInput = z.infer<typeof adjustStockInputSchema>;

/** ADR-193 phase 5 — set / clear an item's Reorder Level and Reorder Qty
 *  (decimals only for KGS / MTR items; the server checks the UOM). */
export const setReorderInputSchema = z.object({
  itemId: z.string().uuid(),
  reorderLevel: z.number().nonnegative().multipleOf(0.001),
  reorderQty: z.number().nonnegative().multipleOf(0.001),
});
export type SetReorderInput = z.infer<typeof setReorderInputSchema>;

// ─── Reorder List + one-click PR (ADR-193 phase 5) ─────────────────────────

export interface ReorderListRow {
  itemId: string;
  itemCode: string;
  itemName: string | null;
  uom: string;
  itemType: string;
  reorderLevel: number;
  reorderQty: number;
  availableQty: number;
  onPoQty: number;
  /** max(Reorder Qty, Reorder Level − (Available + On PO)); whole for NOS / SET. */
  suggestedQty: number;
  /** Open (not ordered / cancelled) PRs for the item — the row cannot be ticked. */
  openPrs: Array<{ id: string; code: string; qty: number }>;
  /** Vendor of the item's latest purchase order; null = pick one. */
  suggestedVendor: { id: string; code: string; name: string } | null;
}

/** GET /store-inventory/reorder-list — paged (ADR-201). */
export const reorderListQuerySchema = z.object({
  /** Sort & Filter (ADR-200): JSON sort + column filters, see list-query.ts. */
  sf: sfRawParamSchema,
  limit: z.coerce.number().int().positive().max(1000).default(1000),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ReorderListQuery = z.infer<typeof reorderListQuerySchema>;

export interface ReorderListResponse {
  items: ReorderListRow[];
  /** Every item Below Reorder (same filters), not just this page. */
  total: number;
}

export const reorderPrInputSchema = z.object({
  lines: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        qty: z.number().positive('PR Qty must be more than 0').multipleOf(0.001),
        vendorId: z.string().uuid({ message: 'Pick the vendor' }),
        requiredDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      }),
    )
    .min(1, 'Tick at least one item')
    .max(200)
    .refine((ls) => new Set(ls.map((l) => l.itemId)).size === ls.length, {
      message: 'An item is listed twice',
    }),
});
export type ReorderPrInput = z.infer<typeof reorderPrInputSchema>;

export interface ReorderPrResult {
  created: Array<{ itemCode: string; prId: string; prCode: string; qty: number }>;
  /** Not raised — e.g. an open PR appeared meanwhile, or it is no longer Below Reorder. */
  skipped: Array<{ itemCode: string; reason: string }>;
}
