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
  // Money — NULL when the viewer's access hides prices.
  rate: z.number().nonnegative().nullable(),
  hasRate: z.boolean(),
  value: z.number().nonnegative().nullable(),
  lastGrnDate: z.string().nullable(),
  minStock: z.number().int().nonnegative(),
  lowStock: z.boolean(),
});
export type StockValuationRow = z.infer<typeof stockValuationRowSchema>;

export const stockValuationCategorySchema = z.object({
  category: z.string(),
  count: z.number().int().nonnegative(),
  stockCount: z.number().int().nonnegative(),
  value: z.number().nonnegative().nullable(), // NULL when prices hidden
});
export type StockValuationCategory = z.infer<typeof stockValuationCategorySchema>;

export const stockValuationResponseSchema = z.object({
  rows: z.array(stockValuationRowSchema),
  categories: z.array(stockValuationCategorySchema),
  grandTotal: z.number().nonnegative().nullable(), // NULL when prices hidden

  grandItems: z.number().int().nonnegative(),
  grandStockItems: z.number().int().nonnegative(),
  /** Told, not inferred. The server strips money it may not send and states it
   *  here, so a client never has to guess from a null value. A null money field
   *  also means "no value yet", and probing it made one unpriced row hide the
   *  money columns from a user fully entitled to see them. */
  priceVisible: z.boolean(),
});
export type StockValuationResponse = z.infer<typeof stockValuationResponseSchema>;
