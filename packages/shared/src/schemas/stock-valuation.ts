// Stock Valuation shared schemas. Mirror of legacy renderStockValuation
// (L20927). Stock value = on-hand qty × rate, where rate = last GRN rate →
// last PO rate → none. Grouped by item type (component/assembly per our model).
// Read-only.

import { z } from 'zod';
import { sfRawParamSchema } from './list-query';

// ADR-201 — the screen pages at 25; the item-type / zero-stock filters, the
// search, Sort & Filter and the page run on the SERVER over every item.
// No `limit` → every matching row (the Excel export pages through them).
export const stockValuationQuerySchema = z.object({
  category: z.string().max(60).optional(),
  showZero: z.preprocess((v) => v === true || v === 'true' || v === '1', z.boolean()).optional(),
  search: z.string().max(200).optional(),
  sf: sfRawParamSchema,
  limit: z.coerce.number().int().positive().max(1000).optional(),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type StockValuationQuery = z.input<typeof stockValuationQuerySchema>;

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
  minStock: z.number().nonnegative(),
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
  /** Rows matching the filters (every page) — the pager's total. */
  total: z.number().int().nonnegative(),
  /** Stock value of EVERY matching row (the totals row), NULL when prices hidden. */
  filteredValue: z.number().nonnegative().nullable(),
  /** Told, not inferred. The server strips money it may not send and states it
   *  here, so a client never has to guess from a null value. A null money field
   *  also means "no value yet", and probing it made one unpriced row hide the
   *  money columns from a user fully entitled to see them. */
  priceVisible: z.boolean(),
});
export type StockValuationResponse = z.infer<typeof stockValuationResponseSchema>;
