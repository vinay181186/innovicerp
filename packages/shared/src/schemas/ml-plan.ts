// Multi-Level Plan (ADR-225 phase 3) — ERPNext Production Plan for one SO line
// whose item has a Default Multi-Level BOM.
//
// Creating it COPIES the BOM tree into ml_plan_nodes and works out the figures
// ONCE (a snapshot, as ERPNext's "Get Sub Assembly Items"). The copy pins the
// BOM revision: later BOM edits do not move a plan — `bomChanged` says so.
// While Draft, Refresh re-copies from the BOM as it is now.
//
// Figures per node (stored at snapshot, numeric(14,3) as strings):
//   Gross Need = parent's Net Need × Qty per Set   (top row: Plan Qty)
//   From Stock = free stock given to this node, item by item in tree order
//                (one pool per item, so the same item on two rows is not
//                counted twice)
//   On PO / PR = open PO + open PR qty given to a Buy / Outsource node
//                (same pooling); 0 on Manufacture rows
//   Net Need   = Gross Need − From Stock − On PO / PR, never below 0; rounded
//                UP to whole pieces when the item's UOM is a whole-number UOM
//   A sub-assembly's children are worked from ITS Net Need — MA-10 in stock
//   means fewer bolts.
// The top row (the SO line's item) is not netted: Net Need = Plan Qty.
//
// Phase 4 adds the orders made from a node: `raisedQty` (live) and
// `toRaiseQty` = Net Need − Raised. In phase 3 both read 0 / Net Need.
//
// Who may: access key `mlplan_create` (Planning).
// Which SO lines (ADR-225 decisions 3 and 6): SO type Component Manufacturing
// or With Material, line open, line item type Assembly with a Default
// Multi-Level BOM, no live Multi-Level Plan on the line yet, and no BOM Master
// plan on the line (one line uses old or new BOM, never both).

import { z } from 'zod';
import { sfRawParamSchema } from './list-query';
import { expectedUpdatedAtSchema } from '../lib/edit-conflict';
import { activityReasonSchema } from '../enums/activity';
import { mlBomLineTypeSchema } from './ml-bom';
import { mlPlanOrderSchema } from './ml-plan-orders';

export const ML_PLAN_STATUSES = ['draft', 'released', 'cancelled'] as const;
export type MlPlanStatus = (typeof ML_PLAN_STATUSES)[number];
export const mlPlanStatusSchema = z.enum(ML_PLAN_STATUSES);

export const ML_PLAN_STATUS_LABEL: Record<MlPlanStatus, string> = {
  draft: 'Draft',
  released: 'Released',
  cancelled: 'Cancelled',
};

// ─── Read shapes ───────────────────────────────────────────────────────────

export const mlPlanSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  /** IN-MLP-00001 */
  code: z.string(),
  salesOrderId: z.string().uuid(),
  soCode: z.string(),
  /** ADR-207 Internal SO No. */
  soInternalNo: z.string().nullable(),
  soLineId: z.string().uuid(),
  lineNo: z.number().int(),
  clientPoLineNo: z.string().nullable(),
  itemId: z.string().uuid(),
  itemCode: z.string().nullable(),
  itemName: z.string().nullable(),
  itemRevision: z.string().nullable(),
  /** The SO line's Order Qty. */
  orderQty: z.number().int(),
  /** Complete sets this plan is for (≤ Order Qty). */
  planQty: z.number().int().positive(),
  mlBomId: z.string().uuid(),
  mlBomCode: z.string(),
  /** BOM Rev copied into the plan. */
  mlBomRevision: z.number().int().positive(),
  /** The BOM's current BOM Rev is not the copied one. */
  bomChanged: z.boolean(),
  status: mlPlanStatusSchema,
  remarks: z.string().nullable(),
  /** When the tree was last copied and the figures worked out. */
  snapshotAt: z.string(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
});
export type MlPlan = z.infer<typeof mlPlanSchema>;

export const mlPlanNodeSchema = z.object({
  id: z.string().uuid(),
  parentNodeId: z.string().uuid().nullable(),
  /** Level — top row 0. */
  depth: z.number().int().nonnegative(),
  /** Display order (depth-first by BOM line no.). */
  seq: z.number().int().nonnegative(),
  itemId: z.string().uuid(),
  itemCode: z.string().nullable(),
  itemName: z.string().nullable(),
  uom: z.string().nullable(),
  /** null on the top row. */
  bomType: mlBomLineTypeSchema.nullable(),
  /** What Raise Orders makes from this row — decided by the server. */
  raises: z.enum(['plan', 'pr', 'outsource_plan']),
  /** Built from its own Multi-Level BOM (top row and sub-assemblies). */
  isSubAssembly: z.boolean(),
  mlBomId: z.string().uuid().nullable(),
  mlBomCode: z.string().nullable(),
  mlBomRevision: z.number().int().positive().nullable(),
  /** null on the top row. */
  qtyPerSet: z.string().nullable(),
  grossNeedQty: z.string(),
  fromStockQty: z.string(),
  onPoPrQty: z.string(),
  netNeedQty: z.string(),
  /** Phase 4 — plans / PRs made from this row (live). */
  raisedQty: z.string(),
  /** Phase 4 — Net Need − Raised, never below 0. */
  toRaiseQty: z.string(),
  rawMaterialGradeText: z.string().nullable(),
  rawMaterialSizeText: z.string().nullable(),
});
export type MlPlanNode = z.infer<typeof mlPlanNodeSchema>;

export const mlPlanDetailSchema = mlPlanSchema.extend({
  nodes: z.array(mlPlanNodeSchema),
  /** Phase 4 — every plan / PR raised from this plan's rows, newest first. */
  orders: z.array(mlPlanOrderSchema).default([]),
});
export type MlPlanDetail = z.infer<typeof mlPlanDetailSchema>;

export const mlPlanListItemSchema = mlPlanSchema.extend({
  nodeCount: z.number().int().nonnegative(),
  levels: z.number().int().nonnegative(),
});
export type MlPlanListItem = z.infer<typeof mlPlanListItemSchema>;

// ─── Queries ───────────────────────────────────────────────────────────────

export const listMlPlansQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(),
  status: mlPlanStatusSchema.optional(),
  salesOrderId: z.string().uuid().optional(),
  sf: sfRawParamSchema,
  limit: z.coerce.number().int().positive().max(200).default(25),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListMlPlansQuery = z.infer<typeof listMlPlansQuerySchema>;

export interface ListMlPlansResponse {
  items: MlPlanListItem[];
  total: number;
  limit: number;
  offset: number;
}

/** GET /ml-plans/eligible-lines — SO lines a Multi-Level Plan can be made for. */
export const mlPlanEligibleLinesQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(),
  salesOrderId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(100).default(25),
});
export type MlPlanEligibleLinesQuery = z.infer<typeof mlPlanEligibleLinesQuerySchema>;

export const mlPlanEligibleLineSchema = z.object({
  soLineId: z.string().uuid(),
  salesOrderId: z.string().uuid(),
  soCode: z.string(),
  soInternalNo: z.string().nullable(),
  lineNo: z.number().int(),
  clientPoLineNo: z.string().nullable(),
  itemId: z.string().uuid(),
  itemCode: z.string().nullable(),
  itemName: z.string().nullable(),
  itemRevision: z.string().nullable(),
  orderQty: z.number().int(),
  dueDate: z.string().nullable(),
  mlBomId: z.string().uuid(),
  mlBomCode: z.string(),
});
export type MlPlanEligibleLine = z.infer<typeof mlPlanEligibleLineSchema>;

export const mlPlanEligibleLinesResponseSchema = z.object({
  lines: z.array(mlPlanEligibleLineSchema),
});
export type MlPlanEligibleLinesResponse = z.infer<typeof mlPlanEligibleLinesResponseSchema>;

// ─── Writes ────────────────────────────────────────────────────────────────

export const createMlPlanInputSchema = z.object({
  soLineId: z.string().uuid(),
  planQty: z.number().int().positive(),
  remarks: z.string().trim().max(1000).nullable().optional(),
});
export type CreateMlPlanInput = z.infer<typeof createMlPlanInputSchema>;

/** Draft only — changes Plan Qty / Remarks and re-works the figures. */
export const updateMlPlanInputSchema = z.object({
  planQty: z.number().int().positive(),
  remarks: z.string().trim().max(1000).nullable().optional(),
  expectedUpdatedAt: expectedUpdatedAtSchema,
});
export type UpdateMlPlanInput = z.infer<typeof updateMlPlanInputSchema>;

/** Draft only — re-copy the tree from the BOM as it is now. */
export const refreshMlPlanInputSchema = z.object({
  expectedUpdatedAt: expectedUpdatedAtSchema,
});
export type RefreshMlPlanInput = z.infer<typeof refreshMlPlanInputSchema>;

/** Refused while any order made from the plan is live (phase 4). */
export const cancelMlPlanInputSchema = z.object({
  reason: activityReasonSchema,
  expectedUpdatedAt: expectedUpdatedAtSchema,
});
export type CancelMlPlanInput = z.infer<typeof cancelMlPlanInputSchema>;
