// Stock Valuation shared schemas. Mirror of legacy renderStockValuation
// (L20927). Stock value = on-hand qty × rate, where rate = last GRN rate →
// last PO rate → none. Grouped by item type (component/assembly per our model).
// Read-only.

import { z } from 'zod';

export const stockValuationRowSchema = z.object({
  itemId: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  uom: z.string(),
  category: z.string(), // itemType: component | assembly
  stockQty: z.number().int(),
  rate: z.number().nonnegative(),
  hasRate: z.boolean(),
  value: z.number().nonnegative(),
  lastGrnDate: z.string().nullable(),
  minStock: z.number().int().nonnegative(),
  lowStock: z.boolean(),
});
export type StockValuationRow = z.infer<typeof stockValuationRowSchema>;

export const stockValuationCategorySchema = z.object({
  category: z.string(),
  count: z.number().int().nonnegative(),
  stockCount: z.number().int().nonnegative(),
  value: z.number().nonnegative(),
});
export type StockValuationCategory = z.infer<typeof stockValuationCategorySchema>;

export const stockValuationResponseSchema = z.object({
  rows: z.array(stockValuationRowSchema),
  categories: z.array(stockValuationCategorySchema),
  grandTotal: z.number().nonnegative(),
  grandItems: z.number().int().nonnegative(),
  grandStockItems: z.number().int().nonnegative(),
});
export type StockValuationResponse = z.infer<typeof stockValuationResponseSchema>;
