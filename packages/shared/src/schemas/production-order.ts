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
  /** Qty actually credited to stock at close (the JC's finished qty). Null while open. */
  creditedQty: z.number().int().nonnegative().nullable(),
  remarks: z.string().nullable(),

  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type ProductionOrder = z.infer<typeof productionOrderSchema>;

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
  /** True when Close is allowed right now: status open AND jcComputedStatus in
   *  ('complete','closed'). */
  canClose: z.boolean(),
  /** Plain-English reason Close is blocked (null when canClose). */
  closeBlockedReason: z.string().nullable(),
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
  remarks: z.string().trim().max(500).nullable().optional(),
});
export type CloseProductionOrderInput = z.infer<typeof closeProductionOrderInputSchema>;

/** `GET /production-orders/next-code` */
export interface NextProductionOrderCodeResponse {
  code: string;
}
