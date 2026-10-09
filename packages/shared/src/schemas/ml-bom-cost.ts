// Multi-Level BOM — cost estimate (ADR-225 phase 6). An ESTIMATE, rolled up
// from the rates the ERP already holds; items carry no rate of their own.
//
// Per tree row, for ONE parent (then × Exploded Qty):
//   Buy / Outsource row → Unit Rate = the item's last PO rate behind its latest
//                         GRN, else its latest non-draft PO rate (the same
//                         rule Stock Valuation uses), else no rate.
//   Manufacture leaf     → Material = Route Card RM item's rate × RM Qty per
//                         Piece; plus Operations.
//   Sub-assembly / top   → its children's amounts + its own Operations.
//   Operations           = Σ Route Card op Cycle Time (min) / 60 × the op
//                         machine's Hour Rate.
// A row whose rate is missing counts in `noRateCount` and adds 0 — the total
// is then a floor, and the screen says so.
//
// Who sees it: canSeeFormPrice(user, 'mlbom_create') — same price gate as
// every money figure. Others get 403.

import { z } from 'zod';
import { mlBomLineTypeSchema } from './ml-bom';

export const ML_BOM_RATE_SOURCES = ['grn', 'po', 'route_card', 'roll_up', 'none'] as const;
export type MlBomRateSource = (typeof ML_BOM_RATE_SOURCES)[number];

export const ML_BOM_RATE_SOURCE_LABEL: Record<MlBomRateSource, string> = {
  grn: 'Last GRN',
  po: 'Last PO',
  route_card: 'Route Card',
  roll_up: 'Roll-up',
  none: 'No rate',
};

export const mlBomCostRowSchema = z.object({
  /** Same key as the Tree tab row. */
  key: z.string(),
  depth: z.number().int().nonnegative(),
  itemId: z.string().uuid(),
  itemCode: z.string().nullable(),
  itemName: z.string().nullable(),
  uom: z.string().nullable(),
  bomType: mlBomLineTypeSchema.nullable(),
  explodedQty: z.string(),
  /** Bought rate, or the RM cost of one piece; null when none. */
  materialRate: z.string().nullable(),
  /** Operations cost of one piece (Route Card × machine Hour Rate). */
  operationRate: z.string(),
  /** Cost of ONE of this row (material + operations, or the roll-up). */
  unitCost: z.string().nullable(),
  /** unitCost × Exploded Qty. */
  amount: z.string(),
  rateSource: z.enum(ML_BOM_RATE_SOURCES),
  /** The PO / GRN code the rate came from, when one did. */
  rateRef: z.string().nullable(),
});
export type MlBomCostRow = z.infer<typeof mlBomCostRowSchema>;

export const mlBomCostQuerySchema = z.object({
  qty: z.coerce.number().positive().max(1_000_000).default(1),
});
export type MlBomCostQuery = z.infer<typeof mlBomCostQuerySchema>;

export const mlBomCostResponseSchema = z.object({
  qty: z.number(),
  rows: z.array(mlBomCostRowSchema),
  /** Top row amount — the estimate for `qty` sets. */
  totalCost: z.string(),
  materialCost: z.string(),
  operationCost: z.string(),
  /** Rows that needed a rate and had none (they add 0). */
  noRateCount: z.number().int().nonnegative(),
  currency: z.literal('INR'),
});
export type MlBomCostResponse = z.infer<typeof mlBomCostResponseSchema>;
