// Planning module wire shapes (PL-3 → PL-5).
// Per ADR-030.

import { z } from 'zod';
import { PLAN_EFFECTIVE_STATUSES, PLAN_STATUSES, type PlanStatus } from '../enums/plan-status';
import { PLAN_TYPES, type PlanType } from '../enums/plan-type';
import { OP_TYPES, type OpType } from '../enums/op-type';
import { PLAN_OPS_SOURCES, type PlanOpsSource } from '../enums/plan-ops-source';
import { PLAN_DERIVED_STATUSES, type PlanDerivedStatus } from '../enums/plan-derived-status';

export const planStatusSchema: z.ZodType<PlanStatus> = z.enum(PLAN_STATUSES);
export const planTypeSchema: z.ZodType<PlanType> = z.enum(PLAN_TYPES);
const planOpTypeSchema: z.ZodType<OpType> = z.enum(OP_TYPES);
export const planOpsSourceSchema: z.ZodType<PlanOpsSource> = z.enum(PLAN_OPS_SOURCES);
export const planDerivedStatusSchema: z.ZodType<PlanDerivedStatus> = z.enum(PLAN_DERIVED_STATUSES);

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
  /** Tool number. Added alongside `plan_ops.tool_no` — route cards and jc_ops
   *  both carried one, but the plan in between did not, so a route card's tool
   *  number was dropped on the way to the Job Card AND blanked back onto the
   *  route card the next time a plan for that item was executed. */
  toolNo: z.string().nullable(),
  toolDetails: z.string().nullable(),
  qcRequired: z.boolean(),
  outsourceVendorId: z.string().uuid().nullable(),
  outsourceVendorText: z.string().nullable(),
  outsourceCost: z.string().nullable(), // NULL when prices hidden
  outsourcePrId: z.string().uuid().nullable(),
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
  /** 'plan' = old flow (ops typed on the plan, Execute builds the JC);
   *  'route_card' = new flow (no ops here; a Production Order builds the JC
   *  from the item's Route Card). See enums/plan-ops-source. */
  opsSource: planOpsSourceSchema,

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
  /** Customer Dispatch Date — the day the goods must leave for the customer
   *  (migration 0137). Entered on the plan, defaulted from the SO line's due
   *  date; flows to the Production Order (its date field), the Job Card header
   *  and the Customer Dispatch pending list. */
  customerDispatchDate: z.string().nullable().default(null),

  // Raw material for this plan — two INDEPENDENT master pickers (Grade and
  // Size). Both optional: a Direct Purchase plan buys a finished item and has
  // no raw material. The *Text snapshots are written alongside the FK so an old
  // plan still prints the grade/size it was planned with after a master row is
  // renamed or removed.
  rawMaterialGradeId: z.string().uuid().nullable(),
  rawMaterialGradeText: z.string().nullable(),
  rawMaterialSizeId: z.string().uuid().nullable(),
  rawMaterialSizeText: z.string().nullable(),

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
  /** Told, not inferred. The server strips money it may not send and states it
   *  here, so a client never guesses from a null value — a null money field
   *  also means "no value yet", and probing it hid the money columns from
   *  users fully entitled to see them. */
  priceVisible: z.boolean(),
  // Lightweight joins for the detail view
  itemCode: z.string().nullable(),
  /** The customer's drawing revision, read live off the SO line this plan was
   *  raised against (plans.so_line_id → sales_order_lines.revision).
   *
   *  It is deliberately NOT `items.revision`, which is a different column
   *  describing the item master; substituting it would print a plausible-looking
   *  but wrong revision on every plan.
   *
   *  Null is a correct answer here, never a gap to paper over: a plan carries at
   *  most one of soLineId / jwLineId, so a JW-sourced or ad-hoc plan has no SO
   *  line and therefore no customer revision, and the FK is ON DELETE SET NULL
   *  so a since-deleted SO line also lands here as null. Null must render as the
   *  bare item code — no trailing slash, no placeholder.
   *
   *  Read live rather than snapshotted onto the plan: if the customer reissues
   *  the drawing at Rev C, every plan against that line is planning Rev C. */
  itemRevision: z.string().nullable().default(null),
  /** The customer's PO line number (`POL`) for the SO line this row traces back
   *  to — the same fact the Sales Order line carries, shown beside the item
   *  code on every downstream document (user rule, 2026-09-23). Null when the
   *  row has no SO line behind it (a job-work line, a hand-raised card).
   *  Read-only: the Sales Order is the only place it is typed. */
  clientPoLineNo: z.string().nullable().default(null),
  itemName: z.string().nullable(),
  /** ADR-185 — the same three facts the Plans list states for this plan,
   *  computed by the same code (lib/plan-order-coverage.ts +
   *  lib/plan-derived-status.ts). Null derived status for old
   *  (ops_source 'plan') plans, which keep their stored label. */
  derivedStatus: planDerivedStatusSchema.nullable().default(null),
  coveredQty: z.number().int().nonnegative().default(0),
  pendingQty: z.number().int().nonnegative().default(0),
});
export type PlanDetail = z.infer<typeof planDetailSchema>;

// ─── List query ──────────────────────────────────────────────────────────

export const listPlansQuerySchema = z.object({
  /** ADR-185 — the status the row SHOWS (PLAN_EFFECTIVE_STATUSES): stored
   *  status for old plans, derived status for route-card plans. */
  status: z.enum(PLAN_EFFECTIVE_STATUSES).optional(),
  planType: planTypeSchema.optional(),
  search: z.string().trim().min(1).max(100).optional(),
  soLineId: z.string().uuid().optional(),
  opsSource: planOpsSourceSchema.optional(),
  /** Derived-status filter (route-card-driven plans only; see enums/plan-derived-status). */
  derivedStatus: planDerivedStatusSchema.optional(),
  /** Production → Plans "Pending" button: route-card-driven plans that have no
   *  Production Order yet (route_card_pending + gen_production_order), not cancelled. */
  poPending: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(100),
  offset: z.coerce.number().int().min(0).optional().default(0),
});
export type ListPlansQuery = z.infer<typeof listPlansQuerySchema>;

export const listPlansResponseSchema = z.object({
  items: z.array(
    planSchema.extend({
      itemCode: z.string().nullable(),
      /** Same customer drawing revision as `planDetailSchema.itemRevision` — read
       *  live off the plan's SO line, null on a JW-sourced or ad-hoc plan. See
       *  that field for the full rules; they apply unchanged in the list. */
      itemRevision: z.string().nullable().default(null),
      /** The customer's PO line number (`POL`) for the SO line this row traces back
       *  to — the same fact the Sales Order line carries, shown beside the item
       *  code on every downstream document (user rule, 2026-09-23). Null when the
       *  row has no SO line behind it (a job-work line, a hand-raised card).
       *  Read-only: the Sales Order is the only place it is typed. */
      clientPoLineNo: z.string().nullable().default(null),
      itemName: z.string().nullable(),
      opsCount: z.number().int().nonnegative(),
      /** Computed for `opsSource='route_card'` plans, null for old plans (they
       *  keep their stored planStatus label). */
      derivedStatus: planDerivedStatusSchema.nullable().default(null),
      /** Live Production Order for this plan (one per plan), when any. */
      productionOrderId: z.string().uuid().nullable().default(null),
      productionOrderCode: z.string().nullable().default(null),
      productionOrderStatus: z.string().nullable().default(null),
      /** Code of the JC (plans.jc_id), old or new flow. */
      jcCode: z.string().nullable().default(null),
      /** The Job Card's live computed status (v_jc_status), so the list can
       *  offer Close only once the card is complete / closed. Null when the
       *  plan has no JC yet. */
      jcStatus: z.string().nullable().default(null),
      /** True when the item has an active route card — the Create Production
       *  Order picker uses it to explain "Route card pending". */
      hasRouteCard: z.boolean().default(false),
      /** ADR-182: pieces of this plan already covered by live, non-short-closed
       *  Production Orders (SUM of their orderQty). */
      coveredQty: z.number().int().nonnegative().default(0),
      /** ADR-182: `Pending` (NAMING.md) — planQty − coveredQty, floored at 0.
       *  What a new Production Order may still be raised for. */
      pendingQty: z.number().int().nonnegative().default(0),
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
  // Same 64 as route_card_ops.tool_no and jc_ops.tool_no — the plan is the
  // middle of that chain and must not narrow it.
  toolNo: z.string().trim().max(64).nullable().optional(),
  toolDetails: z.string().trim().max(500).nullable().optional(),
  qcRequired: z.boolean().optional(),
  outsourceVendorId: z.string().uuid().nullable().optional(),
  outsourceVendorText: z.string().trim().max(120).nullable().optional(),
  outsourceCost: z.number().nonnegative().optional(),
});
export type PlanOpInput = z.infer<typeof planOpInputSchema>;

export const createPlanInputSchema = z
  .object({
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

    plannedStartDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    plannedEndDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    customerDispatchDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),

    // Raw material (optional on every plan type) — see planSchema.
    rawMaterialGradeId: z.string().uuid().nullable().optional(),
    rawMaterialGradeText: z.string().trim().max(120).nullable().optional(),
    rawMaterialSizeId: z.string().uuid().nullable().optional(),
    rawMaterialSizeText: z.string().trim().max(160).nullable().optional(),

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
    foDeliveryDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    foCostCenter: z.string().trim().max(80).nullable().optional(),
    foRemarks: z.string().trim().max(500).nullable().optional(),

    remarks: z.string().trim().max(500).nullable().optional(),

    requiredDocs: z.array(planRequiredDocSchema).optional(),

    ops: z.array(planOpInputSchema).optional(),

    /** Defaults to 'plan' (old flow). The Planning screen's Create Plan box sends
     *  'route_card': the server then stores the plan as `planned` straight away
     *  (no ops, no finalize step) — operations arrive later from the Route Card
     *  when a Production Order is created. The client's planType is a placeholder;
     *  the server stores the route card's. */
    opsSource: planOpsSourceSchema.optional(),
  })
  .superRefine((val, ctx) => {
    // opsSource 'route_card': planType is a placeholder — the server stores the
    // item's route-card plan type (ADR-170) and re-stamps it when the Production
    // Order is created, so no planType restriction here.
    if (val.opsSource === 'route_card' && val.ops && val.ops.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ops'],
        message: 'A route-card-driven plan carries no operations of its own',
      });
    }
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
  planDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  planType: planTypeSchema.optional(),
  orderQty: z.number().int().positive().optional(),
  planQty: z.number().int().positive().optional(),
  plannedStartDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  plannedEndDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  customerDispatchDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),

  // Raw material (optional on every plan type) — see planSchema.
  rawMaterialGradeId: z.string().uuid().nullable().optional(),
  rawMaterialGradeText: z.string().trim().max(120).nullable().optional(),
  rawMaterialSizeId: z.string().uuid().nullable().optional(),
  rawMaterialSizeText: z.string().trim().max(160).nullable().optional(),

  dpVendorId: z.string().uuid().nullable().optional(),
  dpVendorCodeText: z.string().trim().max(80).nullable().optional(),
  dpCost: z.number().nonnegative().nullable().optional(),
  dpRemarks: z.string().trim().max(500).nullable().optional(),

  foVendorId: z.string().uuid().nullable().optional(),
  foVendorCodeText: z.string().trim().max(80).nullable().optional(),
  foProcess: z.string().trim().max(200).nullable().optional(),
  foRate: z.number().nonnegative().nullable().optional(),
  foMaterialSrc: z.string().trim().max(200).nullable().optional(),
  foDeliveryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
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
  /** ADR-185 — route-card plans waiting for a route card / for a Production
   *  Order. Every tile counts plans by the status their row shows. */
  rcPending: z.number().int().nonnegative().default(0),
  rcCreated: z.number().int().nonnegative().default(0),
});
export type PlanningDashboardKpi = z.infer<typeof planningDashboardKpiSchema>;

export const planningDashboardResponseSchema = z.object({
  generatedAt: z.string(),
  kpi: planningDashboardKpiSchema,
  /** Recent plans, ordered by plan_date desc. Capped to 50 for the dashboard table. */
  recentPlans: z.array(
    planSchema.extend({
      itemCode: z.string().nullable(),
      /** Same customer drawing revision as `planDetailSchema.itemRevision` — read
       *  live off the plan's SO line, null on a JW-sourced or ad-hoc plan. See
       *  that field for the full rules; they apply unchanged on the dashboard. */
      itemRevision: z.string().nullable().default(null),
      /** The customer's PO line number (`POL`) for the SO line this row traces back
       *  to — the same fact the Sales Order line carries, shown beside the item
       *  code on every downstream document (user rule, 2026-09-23). Null when the
       *  row has no SO line behind it (a job-work line, a hand-raised card).
       *  Read-only: the Sales Order is the only place it is typed. */
      clientPoLineNo: z.string().nullable().default(null),
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
  /** The customer's drawing revision typed on this very SO line
   *  (sales_order_lines.revision) — every row here IS an SO line, so the
   *  revision is read straight off it and is not `items.revision`. Still
   *  nullable because the column only became compulsory text with migration
   *  0119; a null renders as the bare item code, never a trailing slash. */
  itemRevision: z.string().nullable().default(null),
  /** The customer's PO line number (`POL`) for the SO line this row traces back
   *  to — the same fact the Sales Order line carries, shown beside the item
   *  code on every downstream document (user rule, 2026-09-23). Null when the
   *  row has no SO line behind it (a job-work line, a hand-raised card).
   *  Read-only: the Sales Order is the only place it is typed. */
  clientPoLineNo: z.string().nullable().default(null),
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

/** What `GET /plans/default-ops` answers with.
 *
 *  It used to return `{ ops }` and nothing else, which is why planning could
 *  load a route card's operations but never say so — the screen had no code or
 *  revision to show, so a card that loaded and a card that did not exist looked
 *  identical. The card's identity travels with its ops now.
 *
 *  Both identity fields are null when the item has no active route card, which
 *  is also when `ops` is empty. */
export const defaultRouteOpsResponseSchema = z.object({
  ops: z.array(planOpInputSchema),
  routeCardCode: z.string().nullable(),
  // nonnegative: a brand-new route card is Rev 0, and the planning screen
  // must be able to show that rather than fail validation.
  routeCardRevision: z.number().int().nonnegative().nullable(),
  // Raw material picked on the route card, so the Plan can auto-fetch it
  // downstream (grade + size) exactly as it auto-loads the operations.
  rawMaterialGradeId: z.string().uuid().nullable(),
  rawMaterialGradeText: z.string().nullable(),
  rawMaterialSizeId: z.string().uuid().nullable(),
  rawMaterialSizeText: z.string().nullable(),
});
export type DefaultRouteOpsResponse = z.infer<typeof defaultRouteOpsResponseSchema>;
