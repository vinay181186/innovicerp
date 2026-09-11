// Production Dashboard read shapes (Production Wave 4).
//
// Mirrors legacy renderDashboard (HTML L3658) which consumes calcEngine()'s
// enrichedOps + jcStatus. Computed in the API service via raw SQL over
// v_jc_status + v_jc_op_status (no migration).

import { z } from 'zod';
import { JC_PRIORITIES } from '../enums/jc-priority';
import { machineSplitSchema } from './machine-split';

export const productionDashboardCountersSchema = z.object({
  openJc: z.number().int().nonnegative(),
  totalJc: z.number().int().nonnegative(),
  noOpsJc: z.number().int().nonnegative(),
  runningOps: z.number().int().nonnegative(),
  pendingQty: z.number().int().nonnegative(),
  readyOps: z.number().int().nonnegative(),
  readyQty: z.number().int().nonnegative(),
  outsourceOps: z.number().int().nonnegative(),
  atVendor: z.number().int().nonnegative(),
});
export type ProductionDashboardCounters = z.infer<typeof productionDashboardCountersSchema>;

export const productionDashboardJcSchema = z.object({
  jobCardId: z.string().uuid(),
  code: z.string(),
  itemCode: z.string().nullable(),
  /** The customer's drawing revision behind this card, read live off the SO
   *  line it was raised against (job_cards.source_so_line_id →
   *  sales_order_lines.revision). Shown beside the code as `CODE/REV` so the
   *  board names the exact drawing being made. Null is ordinary here, not an
   *  error: a JW-sourced or standalone card has no SO line at all, and the
   *  card then shows the bare code. */
  itemRevision: z.string().nullable().default(null),
  itemName: z.string().nullable(),
  priority: z.enum(JC_PRIORITIES),
  orderQty: z.number().int(),
  doneOps: z.number().int().nonnegative(),
  totalOps: z.number().int().nonnegative(),
  dueDate: z.string().nullable(),
});
export type ProductionDashboardJc = z.infer<typeof productionDashboardJcSchema>;

export const productionDashboardReadyOpSchema = z.object({
  jcOpId: z.string().uuid(),
  /** The card behind this op, so its JC column can link at /job-cards/$id. The
   *  row carried only the code, so the board could name a job card it had no way
   *  to open. */
  jobCardId: z.string().uuid(),
  jobCardCode: z.string(),
  opSeq: z.number().int(),
  operation: z.string(),
  /** WHAT is being made. A job-card number says WHICH JOB, not which part, so
   *  every screen that prints a JC number names the item beside it. Joined from
   *  the card's item (job_cards.item_id -> items), which is NOT NULL. */
  itemCode: z.string().nullable().default(null),
  /** The customer's drawing revision behind that card, read live off the SO line
   *  it was raised against (job_cards.source_so_line_id ->
   *  sales_order_lines.revision) and rendered beside the code as `CODE/REV`.
   *  Never items.revision, which describes the item master and would misname the
   *  drawing being worked to. Null on a JW-sourced or standalone card, which
   *  then shows the bare code. */
  itemRevision: z.string().nullable().default(null),
  itemName: z.string().nullable().default(null),
  /** The machine the REMAINING qty runs on — forward-looking. Not who made
   *  `completedQty`: an op re-routed mid-flight made pieces elsewhere (ADR-126). */
  machineCode: z.string().nullable(),
  /** Who actually made `completedQty`, per machine (ADR-126). See machineSplitSchema. */
  machines: machineSplitSchema,
  orderQty: z.number().int(),
  completedQty: z.number().int().nonnegative(),
  available: z.number().int(),
  pendingHrs: z.number().nonnegative(),
  computedStatus: z.string(),
});
export type ProductionDashboardReadyOp = z.infer<typeof productionDashboardReadyOpSchema>;

// ── Supply Chain Snapshot (legacy L3804-3838) ──────────────────────────────
// Four whole-master figures + the low-stock item chips. Every figure reuses an
// EXISTING computation rather than inventing one:
//   · lowStockCount / zeroStockCount / lowStockItems ← store-inventory
//     service.ts formula (minQty>0 && inStock<=minQty at :130; inStock===0 at
//     :148) over the v_item_stock view (:94).
//   · openPos / todayGrn ← sc-dashboard service.ts predicates (status IN
//     open|partial|qc_pending at :77; grn_date = current_date at :52).
// Composed into GET /production-dashboard's DTO in this module's service.
export const productionDashboardLowStockItemSchema = z.object({
  itemId: z.string().uuid(),
  code: z.string(),
  inStock: z.number().int(),
  minQty: z.number().int().nonnegative(),
});
export type ProductionDashboardLowStockItem = z.infer<
  typeof productionDashboardLowStockItemSchema
>;

export const productionDashboardSupplyChainSchema = z.object({
  lowStockCount: z.number().int().nonnegative(),
  zeroStockCount: z.number().int().nonnegative(),
  openPos: z.number().int().nonnegative(),
  todayGrn: z.number().int().nonnegative(),
  lowStockItems: z.array(productionDashboardLowStockItemSchema),
});
export type ProductionDashboardSupplyChain = z.infer<
  typeof productionDashboardSupplyChainSchema
>;

export const productionDashboardResponseSchema = z.object({
  counters: productionDashboardCountersSchema,
  openJobCards: z.array(productionDashboardJcSchema),
  readyToProcess: z.array(productionDashboardReadyOpSchema),
  supplyChain: productionDashboardSupplyChainSchema,
});
export type ProductionDashboardResponse = z.infer<typeof productionDashboardResponseSchema>;
