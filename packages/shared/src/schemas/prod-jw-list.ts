// Production JW List shared schemas (Production slice B).
//
// Per-JW summary view for the production floor. Mirrors legacy
// renderProdJWList (HTML L22995).

import { z } from 'zod';

export const prodJwListRowSchema = z.object({
  jwId: z.string().uuid(),
  jwCode: z.string(),
  customerName: z.string(),
  jwDate: z.string().nullable(),
  dueDate: z.string().nullable(),
  linesCount: z.number().int().nonnegative(),
  totalQty: z.number().int().nonnegative(),
  doneQty: z.number().int().nonnegative(),
  balanceQty: z.number().int().nonnegative(),
  progressPct: z.number().int().min(0).max(100),
});
export type ProdJwListRow = z.infer<typeof prodJwListRowSchema>;

export const listProdJwQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(),
  limit: z.coerce.number().int().positive().max(500).default(200),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListProdJwQuery = z.infer<typeof listProdJwQuerySchema>;

export interface ListProdJwResponse {
  items: ProdJwListRow[];
  total: number;
  limit: number;
  offset: number;
}
