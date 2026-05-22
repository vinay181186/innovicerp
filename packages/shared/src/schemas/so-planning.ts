// SO Planning workflow wire shapes (PL-4b parity port).
// Per docs/PARITY/so-planning.md.

import { z } from 'zod';
import { planStatusSchema, planTypeSchema } from './plan';

// ─── Left pane: SO list ──────────────────────────────────────────────────

export const planningSoListItemSchema = z.object({
  soId: z.string().uuid(),
  soCode: z.string(),
  customerName: z.string().nullable(),
  soType: z.string(),
  dueDate: z.string().nullable(),
  totalLines: z.number().int().nonnegative(),
  totalQty: z.number().int().nonnegative(),
  totalPlannedQty: z.number().int().nonnegative(),
  /** 0–100. Math: round(totalPlannedQty / totalQty × 100). */
  planningPct: z.number().int().min(0).max(100),
  /** 'fully_planned' (>= 100%), 'partial' (0 < pct < 100), 'unplanned' (0%). */
  planningStatus: z.enum(['fully_planned', 'partial', 'unplanned']),
});
export type PlanningSoListItem = z.infer<typeof planningSoListItemSchema>;

export const planningSoListResponseSchema = z.object({
  generatedAt: z.string(),
  items: z.array(planningSoListItemSchema),
});
export type PlanningSoListResponse = z.infer<typeof planningSoListResponseSchema>;

// ─── Right pane: per-SO detail ───────────────────────────────────────────

export const planningPlanSummarySchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  planType: planTypeSchema,
  planStatus: planStatusSchema,
  planQty: z.number().int().positive(),
  opsCount: z.number().int().nonnegative(),
  hasOutsourceOp: z.boolean(),
  /** Plan-type-specific labels for the per-card status footer. */
  jcCode: z.string().nullable(),
  dpPrCode: z.string().nullable(),
  foPrCode: z.string().nullable(),
  foMatPrCode: z.string().nullable(),
  foVendorCodeText: z.string().nullable(),
});
export type PlanningPlanSummary = z.infer<typeof planningPlanSummarySchema>;

export const planningLineSchema = z.object({
  soLineId: z.string().uuid(),
  lineNo: z.number().int().positive(),
  clientPoLineNo: z.string().nullable(),
  itemId: z.string().uuid().nullable(),
  itemCode: z.string().nullable(),
  itemName: z.string().nullable(),
  orderQty: z.number().int().nonnegative(),
  dueDate: z.string().nullable(),
  plans: z.array(planningPlanSummarySchema),
  /** Sum of all non-cancelled plan_qty for this SO line. */
  totalPlanned: z.number().int().nonnegative(),
  /** max(0, orderQty - totalPlanned). */
  remaining: z.number().int().nonnegative(),
  /** 'fully_planned' / 'partial' / 'unplanned'. */
  lineStatus: z.enum(['fully_planned', 'partial', 'unplanned']),
  /** Equipment SO with a linked BOM master → show §8 Equipment BOM Planning button. */
  hasEquipmentBom: z.boolean(),
  /** SO line item is assembly + sales_order_lines.sourceBomMasterId is set → show §9 BOM Planning. */
  hasAssemblyBom: z.boolean(),
  /** Bound to whichever BOM (Equipment OR assembly) is active for this line. */
  bomMasterId: z.string().uuid().nullable(),
  bomNo: z.string().nullable(),
  bomPartsCount: z.number().int().nonnegative(),
});
export type PlanningLine = z.infer<typeof planningLineSchema>;

export const planningDetailResponseSchema = z.object({
  soId: z.string().uuid(),
  soCode: z.string(),
  customerName: z.string().nullable(),
  soType: z.string(),
  dueDate: z.string().nullable(),
  clientPoNo: z.string().nullable(),
  lines: z.array(planningLineSchema),
});
export type PlanningDetailResponse = z.infer<typeof planningDetailResponseSchema>;

// ─── BOM-planning aggregator (§8 + §9) ───────────────────────────────────

export const planningBomChildSchema = z.object({
  childItemId: z.string().uuid(),
  childItemCode: z.string(),
  childItemName: z.string(),
  qtyPerSet: z.number().nonnegative(),
  /** orderQty × qtyPerSet — total need across the SO. */
  totalNeed: z.number().nonnegative(),
  /** Current on-hand stock for the child item. */
  stockQty: z.number().nonnegative(),
  /** max(0, totalNeed - stockQty). */
  shortfall: z.number().nonnegative(),
  /** Plan-type implied by the BOM line type (purchase → direct_purchase; else manufacture). */
  bomType: z.enum(['manufacture', 'purchase', 'outsource']),
  /** Existing plan for this (so_line × child) cell, if one was already created. */
  existingPlan: planningPlanSummarySchema.nullable(),
});
export type PlanningBomChild = z.infer<typeof planningBomChildSchema>;

export const planningBomResponseSchema = z.object({
  soLineId: z.string().uuid(),
  soCode: z.string(),
  bomMasterId: z.string().uuid(),
  bomNo: z.string(),
  bomRev: z.number().int().nonnegative(),
  parentItemCode: z.string().nullable(),
  parentItemName: z.string().nullable(),
  orderQty: z.number().int().positive(),
  /** §9 'Final Assembly Job Card' applies only to assembly items, not Equipment SOs. */
  supportsAssemblyPlan: z.boolean(),
  /** When true, there's already an assembly plan for this SO line. */
  hasAssemblyPlan: z.boolean(),
  children: z.array(planningBomChildSchema),
});
export type PlanningBomResponse = z.infer<typeof planningBomResponseSchema>;
