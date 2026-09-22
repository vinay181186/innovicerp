// Production Order (IN-PRO-#####) wire shapes. Migration 0133, ADR-169.
//
// A Production Order is the ONE document that turns a plan into a Job Card:
//
//   Plan (qty / dates / raw material)  +  Route Card (the item's operations)
//   +  Target Date   ──Create JC──▶   Job Card   … existing JC flow …
//   ──Close (blocked until the JC is complete)──▶  stock credited ONCE with
//   the Job Card's actually finished qty (48 of a 50 plan credits 48).
//
// One Production Order per plan (`plan_id` unique among live rows). A single
// SO line of 100 may carry several plans, hence several Production Orders.
//
// Progress is never stored here: `jcComputedStatus` / `jcFinishedQty` are read
// off `v_jc_status` / `v_jc_op_status` for the linked Job Card on every read.

import { z } from 'zod';
import {
  PRODUCTION_ORDER_STATUSES,
  type ProductionOrderStatus,
} from '../enums/production-order-status';
import { JC_COMPUTED_STATUSES, type JcComputedStatus } from '../enums/jc-computed-status';

export const productionOrderStatusSchema: z.ZodType<ProductionOrderStatus> =
  z.enum(PRODUCTION_ORDER_STATUSES);
const jcComputedStatusSchema: z.ZodType<JcComputedStatus> = z.enum(JC_COMPUTED_STATUSES);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const productionOrderSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  code: z.string(),
  status: productionOrderStatusSchema,

  planId: z.string().uuid(),
  planCodeText: z.string(),
  /** Snapshot of the plan's SO / JWSO code + line at creation (plans.so_code_text / line_no). */
  soCodeText: z.string().nullable(),
  lineNo: z.number().int().positive().nullable(),

  itemId: z.string().uuid(),
  itemCodeText: z.string(),
  itemNameText: z.string().nullable(),
  /** ADR-178: the SO / JWSO line's drawing revision, read live through the
   *  plan's line (never snapshotted — the customer may reissue the drawing).
   *  Rendered as CODE/REV. */
  itemRevision: z.string().nullable().default(null),

  routeCardId: z.string().uuid(),
  routeCardCodeText: z.string(),
  /** route_cards.current_revision at the moment the JC was built from it. */
  routeCardRevision: z.number().int().nonnegative(),

  jobCardId: z.string().uuid(),
  jcCodeText: z.string(),

  /** = plans.plan_qty at creation = job_cards.order_qty. */
  orderQty: z.number().int().positive(),
  targetDate: isoDate,

  closedAt: z.string().nullable(),
  closedBy: z.string().uuid().nullable(),
  /** RUNNING total credited to stock so far (sum of the close ledger, ADR-179).
   *  0 or null while nothing has been closed; grows with each partial close;
   *  equals orderQty when fully closed (or orderQty − lost on a short close). */
  creditedQty: z.number().int().nonnegative().nullable(),
  /** Pieces recorded as lost on a short close (order_qty − credited on finish).
   *  Null until the PO is closed short. Invariant: credited + lost = order. */
  lostQty: z.number().int().nonnegative().nullable().default(null),
  remarks: z.string().nullable(),

  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type ProductionOrder = z.infer<typeof productionOrderSchema>;

/** One row of the append-only close ledger (`production_order_closes`, ADR-179).
 *  Each partial close is one row; a reversal is another row (isReversal) that
 *  points at the close it undoes. A short close carries lostQty. */
export const productionOrderCloseSchema = z.object({
  id: z.string().uuid(),
  productionOrderId: z.string().uuid(),
  /** Pieces credited by this row (always > 0; a reversal's qty is the amount undone). */
  qty: z.number().int().positive(),
  isReversal: z.boolean(),
  reversesCloseId: z.string().uuid().nullable(),
  /** Set only on the close-short row that finishes the PO under target. */
  lostQty: z.number().int().nonnegative().nullable(),
  remarks: z.string().nullable(),
  closedAt: z.string(),
  closedBy: z.string().uuid(),
  closedByName: z.string().nullable(),
});
export type ProductionOrderClose = z.infer<typeof productionOrderCloseSchema>;

/** Live Job Card progress, joined on every read (never stored on the PO). */
const jcProgressShape = {
  /** `v_jc_status.computed_status` of the linked JC; null only if the JC row is gone. */
  jcComputedStatus: jcComputedStatusSchema.nullable(),
  /** Output of the JC's LAST live op — qc_accepted_qty for a QC / qc_required op,
   *  completed_qty otherwise (= JobCardListItem.lastOpCompletedQty). This is the
   *  qty that Close will credit. */
  jcFinishedQty: z.number().int().nonnegative(),
  jcClosedAt: z.string().nullable(),
};

export const productionOrderListItemSchema = productionOrderSchema.extend({
  ...jcProgressShape,
  /** Customer / client name read live via the plan's SO or JWSO line. */
  partyName: z.string().nullable(),
  /** Raw material (Grade / Size) read live off the plan this order was made
   *  from — the plan's *Text snapshots, never stored again here. Null when the
   *  plan recorded no raw material. */
  rawMaterialGradeText: z.string().nullable().default(null),
  rawMaterialSizeText: z.string().nullable().default(null),
  createdByName: z.string().nullable(),
  closedByName: z.string().nullable(),
});
export type ProductionOrderListItem = z.infer<typeof productionOrderListItemSchema>;

export const productionOrderDetailSchema = productionOrderListItemSchema.extend({
  /** True when a (partial) Close is allowed right now: status not closed AND
   *  availableToClose > 0. ADR-179. */
  canClose: z.boolean(),
  /** Plain-English reason Close is blocked (null when canClose). */
  closeBlockedReason: z.string().nullable(),
  /** Pieces that can be closed right now = max(0, jcFinishedQty − creditedQty).
   *  The close qty field defaults to and is capped at this. */
  availableToClose: z.number().int().nonnegative(),
  /** Pieces still to be closed = max(0, orderQty − creditedQty). */
  remainingQty: z.number().int().nonnegative(),
  /** The close ledger, newest first — every partial close + reversal. */
  closes: z.array(productionOrderCloseSchema),
});
export type ProductionOrderDetail = z.infer<typeof productionOrderDetailSchema>;

// ─── List query ──────────────────────────────────────────────────────────

export const listProductionOrdersQuerySchema = z.object({
  search: z.string().trim().min(1).max(100).optional(),
  /** Header status filter. `pending` = open (the master's Pending button). */
  status: productionOrderStatusSchema.optional(),
  planId: z.string().uuid().optional(),
  jobCardId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(100),
  offset: z.coerce.number().int().min(0).optional().default(0),
});
export type ListProductionOrdersQuery = z.infer<typeof listProductionOrdersQuerySchema>;

export const listProductionOrdersResponseSchema = z.object({
  items: z.array(productionOrderListItemSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});
export type ListProductionOrdersResponse = z.infer<typeof listProductionOrdersResponseSchema>;

// ─── Write inputs ────────────────────────────────────────────────────────

export const createProductionOrderInputSchema = z.object({
  /** Must be a `plans.ops_source = 'route_card'` plan with no live Production Order. */
  planId: z.string().uuid(),
  /** Must be the active route card of the plan's item. */
  routeCardId: z.string().uuid(),
  targetDate: isoDate,
  remarks: z.string().trim().max(500).nullable().optional(),
});
export type CreateProductionOrderInput = z.infer<typeof createProductionOrderInputSchema>;

export const closeProductionOrderInputSchema = z.object({
  /** Pieces to close (credit to stock) now. Omitted = close everything currently
   *  available (jcFinishedQty − creditedQty). The server re-derives the ceiling
   *  under a row lock and rejects a qty above it. ADR-179. */
  qty: z.number().int().positive().optional(),
  /** Close short: finish the PO now even though credited < order. Allowed only
   *  when the JC is complete / settled-with-losses. Records order − credited as
   *  lost, credits the currently-available qty, and marks the PO closed. */
  finish: z.boolean().optional().default(false),
  remarks: z.string().trim().max(500).nullable().optional(),
});
export type CloseProductionOrderInput = z.infer<typeof closeProductionOrderInputSchema>;

/** Undo one close-ledger row: writes a compensating stock-out + reversal row and
 *  lowers credited_qty. Refused if the pieces have already been dispatched. */
export const reverseProductionOrderCloseInputSchema = z.object({
  closeId: z.string().uuid(),
  remarks: z.string().trim().max(500).nullable().optional(),
});
export type ReverseProductionOrderCloseInput = z.infer<
  typeof reverseProductionOrderCloseInputSchema
>;

/** `GET /production-orders/next-code` */
export interface NextProductionOrderCodeResponse {
  code: string;
}
