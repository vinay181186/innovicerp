// SO Planning workflow wire shapes (PL-4b parity port).
// Per docs/PARITY/so-planning.md.

import { z } from 'zod';
import { RESERVATION_SOURCES, RESERVATION_STATUSES } from '../enums/reservation';
import {
  planDerivedStatusSchema,
  planOpsSourceSchema,
  planStatusSchema,
  planTypeSchema,
} from './plan';
import { itemProcurementTypeSchema } from './item';
import { PR_STATUSES } from '../enums/pr-status';

// ─── Left pane: SO list ──────────────────────────────────────────────────

export const planningSoListItemSchema = z.object({
  soId: z.string().uuid(),
  soCode: z.string(),
  /** 'so' = sales_orders row, 'jw' = job_work_orders row. Drives which
   *  table the detail endpoint reads and which line link a new plan uses. */
  source: z.enum(['so', 'jw']),
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
  /** Aggregated item code + part name across this SO/JW's lines — for the
   *  Planning page's client-side item search. Not shown directly. */
  itemsText: z.string().default(''),
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
  /** ADR-170. 'route_card' plans have no ops editor and no Execute — a
   *  Production Order builds their JC. Defaults to 'plan' for older API builds. */
  opsSource: planOpsSourceSchema.default('plan'),
  /** ADR-170. Derived progress for route-card plans, null for old plans. */
  derivedStatus: planDerivedStatusSchema.nullable().default(null),
  productionOrderId: z.string().uuid().nullable().default(null),
  productionOrderCode: z.string().nullable().default(null),
  plannedStartDate: z.string().nullable().default(null),
  plannedEndDate: z.string().nullable().default(null),
  rawMaterialGradeText: z.string().nullable().default(null),
  rawMaterialSizeText: z.string().nullable().default(null),
  remarks: z.string().nullable().default(null),
  planQty: z.number().int().positive(),
  opsCount: z.number().int().nonnegative(),
  hasOutsourceOp: z.boolean(),
  /** Plan-type-specific labels for the per-card status footer. */
  jcId: z.string().uuid().nullable(),
  jcCode: z.string().nullable(),
  dpPrId: z.string().uuid().nullable(),
  dpPrCode: z.string().nullable(),
  foPrId: z.string().uuid().nullable(),
  foPrCode: z.string().nullable(),
  foMatPrId: z.string().uuid().nullable(),
  foMatPrCode: z.string().nullable(),
  foVendorCodeText: z.string().nullable(),
  /** OSP purchase requests auto-raised for this plan's outsource ops (manufacture
   *  plans). Each links back to the jc_op; clickable to the PR detail page. */
  ospPrs: z.array(z.object({ id: z.string().uuid(), code: z.string() })),
});
export type PlanningPlanSummary = z.infer<typeof planningPlanSummarySchema>;

export const planningLineSchema = z.object({
  soLineId: z.string().uuid(),
  lineNo: z.number().int().positive(),
  clientPoLineNo: z.string().nullable(),
  itemId: z.string().uuid().nullable(),
  itemCode: z.string().nullable(),
  /** The customer's drawing revision for this line, read off
   *  `sales_order_lines.revision` — the text the sales user typed against the
   *  customer's drawing, never `items.revision` (a different column about the
   *  item master, which would be a plausible-looking lie here).
   *
   *  Null is a correct answer, not a gap: this same shape carries the lines of a
   *  Job Work Order too, and a JW line has no customer SO line behind it and so
   *  no revision. Null renders as the bare item code — no trailing slash, no
   *  placeholder. */
  itemRevision: z.string().nullable().default(null),
  itemName: z.string().nullable(),
  orderQty: z.number().int().nonnegative(),
  dueDate: z.string().nullable(),
  /** ADR-171. 'buy' lines are purchased, not planned: the Action cell offers
   *  "+ PR" instead of "+ Plan"; `prs` lists the purchase requests raised
   *  against this line and `prQty` (their live qty, cancelled excluded) counts
   *  towards `totalPlanned` / `remaining`. Defaults keep older API builds valid. */
  itemProcurementType: itemProcurementTypeSchema.default('make'),
  prQty: z.number().int().nonnegative().default(0),
  prs: z
    .array(
      z.object({
        id: z.string().uuid(),
        code: z.string(),
        qty: z.number().int().nonnegative(),
        status: z.enum(PR_STATUSES),
        /** PO raised from this PR, when any (code only — for the chip). */
        poCode: z.string().nullable().default(null),
      }),
    )
    .default([]),
  plans: z.array(planningPlanSummarySchema),
  /** Sum of all non-cancelled plan_qty for this SO line. */
  totalPlanned: z.number().int().nonnegative(),
  /**
   * Qty covered by Job Cards created directly against this SO line WITHOUT a
   * plan (sourceSoLineId set, not referenced by any plan.jcId). These are real
   * production not visible to the plans table, so they're counted as covered to
   * stop the "yet to plan" mismatch vs. SO Status Review.
   */
  directJcQty: z.number().int().nonnegative(),
  /** Codes of those plan-less Job Cards, for the "In Production (no plan)" indicator. */
  directJcCodes: z.array(z.string()),
  /** max(0, orderQty - totalPlanned - directJcQty). */
  remaining: z.number().int().nonnegative(),
  /** AVAILABLE stock for this line's item = physical − total active reserved
   *  (ADR-180). Kept under its old name because its MEANING is unchanged — it
   *  has always answered "how much may I still use" — only the arithmetic
   *  behind it moved, now that a reservation no longer removes stock from the
   *  shelf. 0 for a free-text line. Also published as `availableQty` below. */
  stockQty: z.number().int().nonnegative(),
  /** Qty currently RESERVED (booked) to THIS SO line. */
  reservedQty: z.number().int().nonnegative(),
  /** What is actually on the shelf for this item, reserved or not (ADR-180). */
  physicalQty: z.number().int().nonnegative(),
  /** Reserved to EVERY SO line, not just this one — the committed total. */
  totalReservedQty: z.number().int().nonnegative(),
  /** Already shipped against this SO line (sales_order_lines.dispatched_qty). */
  dispatchedQty: z.number().int().nonnegative(),
  /** physical − totalReserved. Same number as `stockQty`, named plainly. */
  availableQty: z.number().int().nonnegative(),
  /** What still has to be made or bought:
   *  max(0, orderQty − dispatchedQty − reservedQty). Stock reserved to this
   *  line already covers part of the order, so it is not planned again. */
  balanceToPlan: z.number().int().nonnegative(),
  /** 'fully_planned' / 'partial' / 'unplanned' — covers plans AND direct JCs. */
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
  /** 'so' | 'jw' — tells the UI whether a new plan links via soLineId or jwLineId. */
  source: z.enum(['so', 'jw']),
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

// ─── Stock reservation (Stage 1) ─────────────────────────────────────────

export const reserveStockInputSchema = z.object({
  /** SO line id (or JW line id for a JW plan) to book the stock against. */
  soLineId: z.string().uuid(),
  itemId: z.string().uuid(),
  qty: z.number().int().positive(),
  soCodeText: z.string(),
  lineNo: z.number().int().positive(),
  /** Where the booking came from. The API forces 'manual' on the public
   *  route — only the Production Order close may write 'auto_production'. */
  source: z.enum(RESERVATION_SOURCES).optional(),
  remarks: z.string().max(500).optional(),
});
export type ReserveStockInput = z.infer<typeof reserveStockInputSchema>;

export const releaseReservationInputSchema = z.object({
  /** The SO line whose booking is being given back. */
  soLineId: z.string().uuid(),
  /** How many pieces to release. Omitted = release everything still held on
   *  this line. Never more than the line's remaining reserved qty. */
  qty: z.number().int().positive().optional(),
  /** Why. Required: giving stock back is a decision someone must own. */
  reason: z.string().trim().min(1, 'A reason is required to release stock').max(500),
});
export type ReleaseReservationInput = z.infer<typeof releaseReservationInputSchema>;

export const soStockReservationSchema = z.object({
  id: z.string().uuid(),
  soLineId: z.string().uuid(),
  itemId: z.string().uuid(),
  itemCode: z.string().nullable(),
  /** Pieces originally booked. */
  qty: z.number().int().nonnegative(),
  /** Of those, how many have shipped. */
  consumedQty: z.number().int().nonnegative(),
  /** Of those, how many were given back. */
  releasedQty: z.number().int().nonnegative(),
  /** qty − consumed − released: what this row still holds. */
  remainingQty: z.number().int().nonnegative(),
  source: z.enum(RESERVATION_SOURCES),
  status: z.enum(RESERVATION_STATUSES),
});
export type SoStockReservation = z.infer<typeof soStockReservationSchema>;

/** Result of a reserve/release action: the affected reservations + qty moved,
 *  plus the three stock numbers AFTER the action so the screen can show the
 *  new position without a second round trip. */
export const reservationActionResultSchema = z.object({
  reservations: z.array(soStockReservationSchema),
  qtyMoved: z.number().int().nonnegative(),
  physicalQty: z.number().int().nonnegative(),
  reservedQty: z.number().int().nonnegative(),
  availableQty: z.number().int().nonnegative(),
});
export type ReservationActionResult = z.infer<typeof reservationActionResultSchema>;

/** The three numbers for one item — the ONE shape every screen reads. */
export const stockAvailabilitySchema = z.object({
  itemId: z.string().uuid(),
  itemCode: z.string().nullable(),
  physicalQty: z.number().int(),
  reservedQty: z.number().int().nonnegative(),
  availableQty: z.number().int(),
});
export type StockAvailability = z.infer<typeof stockAvailabilitySchema>;

/** One row of the "where is my stock reserved?" drill-down (ADR-180 §H). */
export const reservationDetailSchema = z.object({
  id: z.string().uuid(),
  itemId: z.string().uuid(),
  itemCode: z.string().nullable(),
  soLineId: z.string().uuid(),
  soCodeText: z.string(),
  lineNo: z.number().int(),
  customerName: z.string().nullable(),
  itemRevision: z.string().nullable(),
  /** The customer's PO line number (`POL`) for the SO line this row traces back
   *  to, shown beside the item code on every downstream document (user rule,
   *  2026-09-23). Null when no SO line sits behind the row. Read-only — the
   *  Sales Order is the only place it is typed. */
  clientPoLineNo: z.string().nullable().default(null),
  qty: z.number().int().nonnegative(),
  consumedQty: z.number().int().nonnegative(),
  releasedQty: z.number().int().nonnegative(),
  remainingQty: z.number().int().nonnegative(),
  source: z.enum(RESERVATION_SOURCES),
  status: z.enum(RESERVATION_STATUSES),
  productionOrderId: z.string().uuid().nullable(),
  productionOrderCode: z.string().nullable(),
  jobCardId: z.string().uuid().nullable(),
  jobCardCode: z.string().nullable(),
  salesOrderId: z.string().uuid().nullable(),
  reservedAt: z.string(),
  reservedByName: z.string().nullable(),
  remarks: z.string().nullable(),
});
export type ReservationDetail = z.infer<typeof reservationDetailSchema>;

export const listReservationsQuerySchema = z.object({
  itemId: z.string().uuid().optional(),
  soLineId: z.string().uuid().optional(),
  salesOrderId: z.string().uuid().optional(),
  /** Omitted = only the rows still holding stock (active + partially_consumed).
   *  Parsed from the literal string: `z.coerce.boolean()` would turn the
   *  string "false" into TRUE, so an explicit `?includeClosed=false` asked for
   *  the exact opposite of what it said. */
  includeClosed: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type ListReservationsQuery = z.infer<typeof listReservationsQuerySchema>;

export const listReservationsResponseSchema = z.object({
  rows: z.array(reservationDetailSchema),
  totalReserved: z.number().int().nonnegative(),
});
export type ListReservationsResponse = z.infer<typeof listReservationsResponseSchema>;

// ─── Buy lines: raise a purchase request straight from the SO line (ADR-171) ──

/** `POST /so-planning/lines/:soLineId/raise-pr` — for a line whose item is
 *  `procurementType='buy'`. Raises ONE standard purchase request (IN-PR-#####)
 *  for `qty` of the line's item with `source_so_line_id` = the line, so Purchase
 *  sees where the demand came from and the Planning line counts it as planned.
 *  Sales-order lines only: a job-work (JWSO) line is the client's material and
 *  is never bought in. */
export const raisePlanningPrInputSchema = z.object({
  qty: z.number().int().positive(),
  requiredDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  remarks: z.string().trim().max(500).nullable().optional(),
});
export type RaisePlanningPrInput = z.infer<typeof raisePlanningPrInputSchema>;

export const raisePlanningPrResponseSchema = z.object({
  prId: z.string().uuid(),
  prCode: z.string(),
});
export type RaisePlanningPrResponse = z.infer<typeof raisePlanningPrResponseSchema>;
