// Planning module wire shapes (PL-3 → PL-5).
// Per ADR-030.

import { z } from 'zod';
import { PLAN_STATUSES, type PlanStatus } from '../enums/plan-status';
import { PLAN_TYPES, type PlanType } from '../enums/plan-type';
import { OP_TYPES, type OpType } from '../enums/op-type';

export const planStatusSchema: z.ZodType<PlanStatus> = z.enum(PLAN_STATUSES);
export const planTypeSchema: z.ZodType<PlanType> = z.enum(PLAN_TYPES);
const planOpTypeSchema: z.ZodType<OpType> = z.enum(OP_TYPES);

// Legacy editPlan §5.8: per-plan list of QC documents the operator must
// upload during inspection. Mandatory docs block QC completion later.
export const planRequiredDocSchema = z.object({
  name: z.string().trim().min(1).max(120),
  mandatory: z.boolean(),
});
export type PlanRequiredDoc = z.infer<typeof planRequiredDocSchema>;

export const planOpSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  planId: z.string().uuid(),
  opSeq: z.number().int().positive(),
  machineId: z.string().uuid().nullable(),
  machineCodeText: z.string().nullable(),
  operation: z.string(),
  opType: planOpTypeSchema,
  cycleTimeMin: z.string(),
  program: z.string().nullable(),
  toolDetails: z.string().nullable(),
  qcRequired: z.boolean(),
  outsourceVendorId: z.string().uuid().nullable(),
  outsourceVendorText: z.string().nullable(),
  outsourceCost: z.string(),
  outsourcePrId: z.string().uuid().nullable(),
  outsourceLeadDays: z.number().int().nonnegative().nullable(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type PlanOp = z.infer<typeof planOpSchema>;

export const planSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  code: z.string(),
  planDate: z.string(),
  planStatus: planStatusSchema,
  planType: planTypeSchema,

  soLineId: z.string().uuid().nullable(),
  jwLineId: z.string().uuid().nullable(),
  soCodeText: z.string().nullable(),
  lineNo: z.number().int().positive().nullable(),

  itemId: z.string().uuid().nullable(),
  itemCodeText: z.string().nullable(),
  itemNameText: z.string().nullable(),

  orderQty: z.number().int().positive(),
  planQty: z.number().int().positive(),

  plannedStartDate: z.string().nullable(),
  plannedEndDate: z.string().nullable(),

  bomMasterId: z.string().uuid().nullable(),
  bomParentCode: z.string().nullable(),
  bomChildCode: z.string().nullable(),

  jcId: z.string().uuid().nullable(),

  dpVendorId: z.string().uuid().nullable(),
  dpVendorCodeText: z.string().nullable(),
  dpCost: z.string().nullable(),
  dpRemarks: z.string().nullable(),
  dpPrId: z.string().uuid().nullable(),

  foVendorId: z.string().uuid().nullable(),
  foVendorCodeText: z.string().nullable(),
  foProcess: z.string().nullable(),
  foRate: z.string().nullable(),
  foMaterialSrc: z.string().nullable(),
  foDeliveryDate: z.string().nullable(),
  foCostCenter: z.string().nullable(),
  foRemarks: z.string().nullable(),
  foPrId: z.string().uuid().nullable(),
  foMatPrId: z.string().uuid().nullable(),

  materialPrId: z.string().uuid().nullable(),

  requiredDocs: z.array(planRequiredDocSchema),

  remarks: z.string().nullable(),

  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type Plan = z.infer<typeof planSchema>;

export const planDetailSchema = planSchema.extend({
  ops: z.array(planOpSchema),
  // Lightweight joins for the detail view
  itemCode: z.string().nullable(),
  itemName: z.string().nullable(),
});
export type PlanDetail = z.infer<typeof planDetailSchema>;

// ─── List query ──────────────────────────────────────────────────────────

export const listPlansQuerySchema = z.object({
  status: planStatusSchema.optional(),
  planType: planTypeSchema.optional(),
  search: z.string().trim().min(1).max(100).optional(),
  soLineId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(100),
  offset: z.coerce.number().int().min(0).optional().default(0),
});
export type ListPlansQuery = z.infer<typeof listPlansQuerySchema>;

export const listPlansResponseSchema = z.object({
  items: z.array(
    planSchema.extend({
      itemCode: z.string().nullable(),
      itemName: z.string().nullable(),
      opsCount: z.number().int().nonnegative(),
    }),
  ),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});
export type ListPlansResponse = z.infer<typeof listPlansResponseSchema>;

// ─── Create + update inputs ──────────────────────────────────────────────

const planOpInputSchema = z.object({
  opSeq: z.number().int().positive(),
  machineId: z.string().uuid().nullable().optional(),
  machineCodeText: z.string().trim().max(80).nullable().optional(),
  operation: z.string().trim().min(1).max(200),
  opType: planOpTypeSchema.optional(),
  cycleTimeMin: z.number().nonnegative().optional(),
  program: z.string().trim().max(200).nullable().optional(),
  toolDetails: z.string().trim().max(500).nullable().optional(),
  qcRequired: z.boolean().optional(),
  outsourceVendorId: z.string().uuid().nullable().optional(),
  outsourceVendorText: z.string().trim().max(120).nullable().optional(),
  outsourceCost: z.number().nonnegative().optional(),
  outsourceLeadDays: z.number().int().nonnegative().nullable().optional(),
});
export type PlanOpInput = z.infer<typeof planOpInputSchema>;

export const createPlanInputSchema = z.object({
  // Optional — server auto-numbers the next PLN-NNNN when blank/omitted.
  code: z.string().trim().max(40).optional(),
  planDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  planType: planTypeSchema,

  soLineId: z.string().uuid().nullable().optional(),
  jwLineId: z.string().uuid().nullable().optional(),
  soCodeText: z.string().trim().max(40).nullable().optional(),
  lineNo: z.number().int().positive().nullable().optional(),

  itemId: z.string().uuid().nullable().optional(),
  itemCodeText: z.string().trim().max(80).nullable().optional(),
  itemNameText: z.string().trim().max(200).nullable().optional(),

  orderQty: z.number().int().positive(),
  planQty: z.number().int().positive(),

  plannedStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  plannedEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),

  bomMasterId: z.string().uuid().nullable().optional(),
  bomParentCode: z.string().trim().max(80).nullable().optional(),
  bomChildCode: z.string().trim().max(80).nullable().optional(),

  // Type-specific fields (validated by refine below)
  dpVendorId: z.string().uuid().nullable().optional(),
  dpVendorCodeText: z.string().trim().max(80).nullable().optional(),
  dpCost: z.number().nonnegative().nullable().optional(),
  dpRemarks: z.string().trim().max(500).nullable().optional(),

  foVendorId: z.string().uuid().nullable().optional(),
  foVendorCodeText: z.string().trim().max(80).nullable().optional(),
  foProcess: z.string().trim().max(200).nullable().optional(),
  foRate: z.number().nonnegative().nullable().optional(),
  foMaterialSrc: z.string().trim().max(200).nullable().optional(),
  foDeliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  foCostCenter: z.string().trim().max(80).nullable().optional(),
  foRemarks: z.string().trim().max(500).nullable().optional(),

  remarks: z.string().trim().max(500).nullable().optional(),

  requiredDocs: z.array(planRequiredDocSchema).optional(),

  ops: z.array(planOpInputSchema).optional(),
}).superRefine((val, ctx) => {
  // Item identification — at least one of itemId / itemCodeText must be set.
  if (!val.itemId && !val.itemCodeText) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['itemId'],
      message: 'Either itemId or itemCodeText must be set',
    });
  }
  // Type-specific minimums for direct_purchase + full_outsource
  if (val.planType === 'direct_purchase') {
    if (!val.dpVendorId && !val.dpVendorCodeText) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dpVendorId'],
        message: 'direct_purchase plan requires a vendor',
      });
    }
  }
  if (val.planType === 'full_outsource') {
    if (!val.foVendorId && !val.foVendorCodeText) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['foVendorId'],
        message: 'full_outsource plan requires a vendor',
      });
    }
    if (!val.foProcess) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['foProcess'],
        message: 'full_outsource plan requires a process description',
      });
    }
  }
});
export type CreatePlanInput = z.infer<typeof createPlanInputSchema>;

export const updatePlanInputSchema = z.object({
  planDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  planType: planTypeSchema.optional(),
  orderQty: z.number().int().positive().optional(),
  planQty: z.number().int().positive().optional(),
  plannedStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  plannedEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),

  dpVendorId: z.string().uuid().nullable().optional(),
  dpVendorCodeText: z.string().trim().max(80).nullable().optional(),
  dpCost: z.number().nonnegative().nullable().optional(),
  dpRemarks: z.string().trim().max(500).nullable().optional(),

  foVendorId: z.string().uuid().nullable().optional(),
  foVendorCodeText: z.string().trim().max(80).nullable().optional(),
  foProcess: z.string().trim().max(200).nullable().optional(),
  foRate: z.number().nonnegative().nullable().optional(),
  foMaterialSrc: z.string().trim().max(200).nullable().optional(),
  foDeliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  foCostCenter: z.string().trim().max(80).nullable().optional(),
  foRemarks: z.string().trim().max(500).nullable().optional(),

  remarks: z.string().trim().max(500).nullable().optional(),

  requiredDocs: z.array(planRequiredDocSchema).optional(),

  // Replace-all behavior on ops when present (matches sales_orders.lines merge)
  ops: z.array(planOpInputSchema).optional(),
});
export type UpdatePlanInput = z.infer<typeof updatePlanInputSchema>;

// ─── Planning dashboard response ─────────────────────────────────────────

export const planningDashboardKpiSchema = z.object({
  needsPlanning: z.number().int().nonnegative(),
  inPlanning: z.number().int().nonnegative(),
  planned: z.number().int().nonnegative(),
  jcCreated: z.number().int().nonnegative(),
  prCreated: z.number().int().nonnegative(),
  inProduction: z.number().int().nonnegative(),
  complete: z.number().int().nonnegative(),
});
export type PlanningDashboardKpi = z.infer<typeof planningDashboardKpiSchema>;

export const planningDashboardResponseSchema = z.object({
  generatedAt: z.string(),
  kpi: planningDashboardKpiSchema,
  /** Recent plans, ordered by plan_date desc. Capped to 50 for the dashboard table. */
  recentPlans: z.array(
    planSchema.extend({
      itemCode: z.string().nullable(),
      itemName: z.string().nullable(),
      opsCount: z.number().int().nonnegative(),
    }),
  ),
});
export type PlanningDashboardResponse = z.infer<typeof planningDashboardResponseSchema>;

// ─── Needs Planning (PL-3b) — unplanned SO lines list ───────────────────
// Drives the "Needs Planning" tile click on the dashboard.
// Legacy renderPlanDashboard L10024–10041: each row is an open SO/JW line
// where Σ planQty < orderQty. We return the SO-side rows only; JW lines join
// later when the JW path lands.

export const unplannedOrderRowSchema = z.object({
  soLineId: z.string().uuid(),
  soId: z.string().uuid(),
  soCode: z.string(),
  lineNo: z.number().int().positive(),
  itemCode: z.string().nullable(),
  partName: z.string().nullable(),
  customerName: z.string().nullable(),
  dueDate: z.string().nullable(),
  orderQty: z.number().int().nonnegative(),
  plannedQty: z.number().int().nonnegative(),
  remainingQty: z.number().int().nonnegative(),
});
export type UnplannedOrderRow = z.infer<typeof unplannedOrderRowSchema>;

export const unplannedOrdersResponseSchema = z.object({
  generatedAt: z.string(),
  rows: z.array(unplannedOrderRowSchema),
});
export type UnplannedOrdersResponse = z.infer<typeof unplannedOrdersResponseSchema>;

// ─── Execute plan response (PL-4) ────────────────────────────────────────

export const executePlanResultSchema = z.object({
  plan: planDetailSchema,
  jcCode: z.string().optional(),
  primaryPrCode: z.string().optional(),
  materialPrCode: z.string().optional(),
});
export type ExecutePlanResultShape = z.infer<typeof executePlanResultSchema>;

// ─── Default route-card ops loader (PL-4) ────────────────────────────────

export const defaultRouteOpsQuerySchema = z.object({
  itemId: z.string().uuid(),
});
export type DefaultRouteOpsQuery = z.infer<typeof defaultRouteOpsQuerySchema>;
