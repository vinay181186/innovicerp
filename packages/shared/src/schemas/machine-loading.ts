// Machine Loading read shapes (Production Wave 3).
//
// Mirrors legacy renderLoading (HTML L5021) which consumes calcEngine()'s
// machineLoad (L1703-1715) + enrichedOps. Computed in the API service via raw
// SQL — no migration/view (like job-cards/store-inventory services).
//
// Per-machine load (legacy L1703-1715), ported to our schema where
// jc_ops.cycle_time_min is MINUTES (legacy cycleTime was hours):
//   pendingHrs  = Σ (available × cycle_time_min / 60)
//   dailyCap    = capacity_per_shift × shifts_per_day
//   weekCap     = dailyCap × 5
//   loadPct     = weekCap > 0 ? pendingHrs / weekCap : 0
//   daysToClear = dailyCap > 0 ? pendingHrs / dailyCap : 0
//   loadStatus  = loadPct>1 Overloaded · >0.7 High Load · pendingHrs>0 Manageable · Clear

import { z } from 'zod';
import { JC_PRIORITIES } from '../enums/jc-priority';
import { sfRawParamSchema } from './list-query';
import { machineSplitSchema } from './machine-split';

export const MACHINE_LOAD_STATUSES = ['Clear', 'Manageable', 'High Load', 'Overloaded'] as const;
export const machineLoadStatusSchema = z.enum(MACHINE_LOAD_STATUSES);
export type MachineLoadStatus = (typeof MACHINE_LOAD_STATUSES)[number];

/** One open operation across all machines (operation view + queue grouping). */
export const machineLoadOpSchema = z.object({
  jcOpId: z.string().uuid(),
  jobCardId: z.string().uuid(),
  jobCardCode: z.string(),
  opSeq: z.number().int(),
  operation: z.string(),
  /** The machine the REMAINING qty runs on — forward-looking. Not who made
   *  `completedQty`: an op re-routed mid-flight made pieces elsewhere (ADR-126). */
  machineId: z.string().uuid().nullable(),
  machineCode: z.string().nullable(),
  /** Who actually made `completedQty`, per machine (ADR-126). See machineSplitSchema. */
  machines: machineSplitSchema,
  itemCode: z.string().nullable(),
  /** The customer's drawing revision for this op's item, read off the SO line the
   *  job card was raised against (job_cards.source_so_line_id →
   *  sales_order_lines.revision). Null is the correct, common answer on this
   *  board: a JW-sourced or standalone card has no SO line behind it, and null
   *  renders as the bare item code. Never `items.revision`, which describes the
   *  item master and would read to a machinist as a drawing revision it is not. */
  itemRevision: z.string().nullable().default(null),
  /** The customer's PO line number (`POL`) for the SO line this row traces back
   *  to — the same fact the Sales Order line carries, shown beside the item
   *  code on every downstream document (user rule, 2026-09-23). Null when the
   *  row has no SO line behind it (a job-work line, a hand-raised card).
   *  Read-only: the Sales Order is the only place it is typed. */
  clientPoLineNo: z.string().nullable().default(null),
  itemName: z.string().nullable(),
  soCode: z.string().nullable(),
  /** ADR-207 — the SO's Internal SO No., read live from sales_orders. */
  soInternalNo: z.string().nullable().default(null),
  priority: z.enum(JC_PRIORITIES),
  dueDate: z.string().nullable(),
  orderQty: z.number().int(),
  completedQty: z.number().int().nonnegative(),
  available: z.number().int(),
  pendingHrs: z.number().nonnegative(),
  computedStatus: z.string(),
});
export type MachineLoadOp = z.infer<typeof machineLoadOpSchema>;

/** Per-machine capacity card. */
export const machineLoadCardSchema = z.object({
  machineId: z.string().uuid(),
  machineCode: z.string(),
  name: z.string(),
  machineType: z.string().nullable(),
  totalAvailQty: z.number().int().nonnegative(),
  openOps: z.number().int().nonnegative(),
  pendingHrs: z.number().nonnegative(),
  dailyCap: z.number().nonnegative(),
  weekCap: z.number().nonnegative(),
  loadPct: z.number().nonnegative(),
  daysToClear: z.number().nonnegative(),
  loadStatus: machineLoadStatusSchema,
});
export type MachineLoadCard = z.infer<typeof machineLoadCardSchema>;

export const machineLoadingResponseSchema = z.object({
  machines: z.array(machineLoadCardSchema),
  ops: z.array(machineLoadOpSchema),
  /** Paged mode (ADR-201): every op matching machine + search + scope + sf. */
  total: z.number().int().nonnegative().optional(),
});

/**
 * GET /machine-loading. No `limit` = the whole board, exactly as before (the
 * production dashboard reads it). With `limit` (ADR-201): `ops` is one page,
 * filtered on the server; `machines` (the load cards + Capacity Summary) are
 * always every machine's whole-queue totals.
 */
export const machineLoadingQuerySchema = z.object({
  machineId: z.string().uuid().optional(),
  /** JC no., POL, CODE/REV, item name, SO no., operation. */
  search: z.string().trim().max(200).optional(),
  /** 'ops' (default) = the Operation View: available > 0 or partly done.
   *  'queue' = every non-complete op (the printed machine queue). */
  scope: z.enum(['ops', 'queue']).optional(),
  sf: sfRawParamSchema,
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
export type MachineLoadingQuery = z.infer<typeof machineLoadingQuerySchema>;
export type MachineLoadingResponse = z.infer<typeof machineLoadingResponseSchema>;
