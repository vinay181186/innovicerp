// Production SO List shared schemas (Production slice B).
//
// Per-SO summary view for the production floor. Mirrors legacy
// renderProdSOList (HTML L22954).

import { z } from 'zod';

export const prodSoListRowSchema = z.object({
  soId: z.string().uuid(),
  soCode: z.string(),
  customerName: z.string(),
  soType: z.string(),
  soDate: z.string().nullable(),
  dueDate: z.string().nullable(),
  linesCount: z.number().int().nonnegative(),
  totalQty: z.number().int().nonnegative(),
  doneQty: z.number().int().nonnegative(),
  balanceQty: z.number().int().nonnegative(),
  progressPct: z.number().int().min(0).max(100),
});
export type ProdSoListRow = z.infer<typeof prodSoListRowSchema>;

export const listProdSoQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(),
  limit: z.coerce.number().int().positive().max(500).default(200),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListProdSoQuery = z.infer<typeof listProdSoQuerySchema>;

export interface ListProdSoResponse {
  items: ProdSoListRow[];
  total: number;
  limit: number;
  offset: number;
}
