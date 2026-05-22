// Store / Inventory shared schemas (PL-SI-1).
//
// Per-item current-state rollup. Mirrors legacy renderStore (HTML L24803).
// Each row carries: in_stock, min_qty, on_po (open PO pending), mfg_pending
// (open JC pending qty), + lowStock flag derived from minQty + stockQty.

import { z } from 'zod';

export const storeInventoryRowSchema = z.object({
  itemId: z.string().uuid(),
  itemCode: z.string(),
  itemName: z.string(),
  material: z.string().nullable(),
  uom: z.string(),
  inStock: z.number().int(),
  minQty: z.number().int().nonnegative(),
  /** Σ pending qty on open POs (qty − received). */
  onPoQty: z.number().int().nonnegative(),
  /** Σ pending qty on open JCs (order_qty − completed). */
  mfgPendingQty: z.number().int().nonnegative(),
  /** true when minQty > 0 AND inStock <= minQty. */
  lowStock: z.boolean(),
});
export type StoreInventoryRow = z.infer<typeof storeInventoryRowSchema>;

/** 4-tile KPI strip data — legacy renderStore L24876–24891. */
export const storeInventorySummarySchema = z.object({
  totalItems: z.number().int().nonnegative(),
  totalStockPieces: z.number().int().nonnegative(),
  itemsInStockCount: z.number().int().nonnegative(),
  lowStockCount: z.number().int().nonnegative(),
  zeroStockCount: z.number().int().nonnegative(),
});
export type StoreInventorySummary = z.infer<typeof storeInventorySummarySchema>;

export const listStoreInventoryQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(),
  /** all | low | zero */
  filter: z.enum(['all', 'low', 'zero']).default('all'),
});
export type ListStoreInventoryQuery = z.infer<typeof listStoreInventoryQuerySchema>;

export const listStoreInventoryResponseSchema = z.object({
  generatedAt: z.string(),
  filter: z.enum(['all', 'low', 'zero']),
  rows: z.array(storeInventoryRowSchema),
  summary: storeInventorySummarySchema,
});
export type ListStoreInventoryResponse = z.infer<typeof listStoreInventoryResponseSchema>;

// ─── Write inputs ─────────────────────────────────────────────────────────

/** Manual stock adjustment (+ Add / − Remove). Writes a store_transactions row. */
export const adjustStockInputSchema = z.object({
  itemId: z.string().uuid(),
  direction: z.enum(['add', 'remove']),
  qty: z.number().int().positive(),
  remarks: z.string().trim().min(1).max(255),
});
export type AdjustStockInput = z.infer<typeof adjustStockInputSchema>;

/** Set / clear min stock level for an item. */
export const setMinStockInputSchema = z.object({
  itemId: z.string().uuid(),
  minQty: z.number().int().nonnegative(),
});
export type SetMinStockInput = z.infer<typeof setMinStockInputSchema>;
