// Job Queue shared schemas (Production slice F).
//
// Pending ops per machine, manually reorderable. Mirrors legacy
// renderJobQueue (HTML L10363).

import { z } from 'zod';
import { machineSplitSchema } from './machine-split';

export const jobQueueRowSchema = z.object({
  jcOpId: z.string().uuid(),
  jcId: z.string().uuid(),
  jcCode: z.string(),
  itemCode: z.string().nullable(),
  /** The customer's drawing revision, taken from the SO line the job card was
   *  raised against (job_cards.source_so_line_id → sales_order_lines.revision).
   *  Null when there is no SO line to read — a JW-sourced or standalone card —
   *  which is ordinary here, and shows as the bare item code. Not
   *  `items.revision`: that column is about the item master, not this order's
   *  drawing. */
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
  soCustomer: z.string().nullable(),
  opSeq: z.number().int().positive(),
  operation: z.string(),
  priority: z.string(),
  dueDate: z.string().nullable(),
  orderQty: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  /** Who actually made `completed`, per machine (ADR-126). The row is bucketed
   *  under the machine that runs the REMAINING qty, which on a re-routed op is
   *  not the machine that made the completed figure. See machineSplitSchema. */
  machines: machineSplitSchema,
  available: z.number().int().nonnegative(),
  /** 11-state enum from calc-engine. */
  status: z.string(),
  /** True when this op has an active running_ops record. */
  isRunning: z.boolean(),
  queuePosition: z.number().int().nullable(),
  /** 0-based place of this op in its machine's FULL queue (paged mode only,
   *  ADR-201) — Sr No and the ▲/▼ limits read it, since a 25-row page no
   *  longer holds the whole queue. */
  queueIndex: z.number().int().nonnegative().optional(),
});
export type JobQueueRow = z.infer<typeof jobQueueRowSchema>;

export const jobQueueMachineSchema = z.object({
  machineId: z.string().uuid(),
  machineCode: z.string(),
  machineName: z.string().nullable(),
  machineType: z.string().nullable(),
  /** Sum of (cycle_min × available) across queue, in hours. */
  pendingHrs: z.number(),
  /** Active running_ops count. */
  runningCount: z.number().int().nonnegative(),
  /** Pending ops count. */
  pendingCount: z.number().int().nonnegative(),
  rows: z.array(jobQueueRowSchema),
});
export type JobQueueMachine = z.infer<typeof jobQueueMachineSchema>;

export const jobQueueQuerySchema = z.object({
  /** Without `limit`: only this machine is returned (unchanged). With `limit`
   *  (paged mode): only this machine's ROWS are paged, while every machine's
   *  summary (pendingCount / pendingHrs / runningCount) is still returned for
   *  the machine picker. */
  machineId: z.string().uuid().optional(),
  /** Paged mode only: JC no., POL, CODE/REV, item name, SO no., customer,
   *  operation — over the WHOLE queue on the server. */
  search: z.string().trim().max(200).optional(),
  /** Set → paged mode (ADR-201): `rows` hold just this page, `total` = every
   *  matching row. Unset → the whole queue, as before. */
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
export type JobQueueQuery = z.infer<typeof jobQueueQuerySchema>;

export interface JobQueueResponse {
  machines: JobQueueMachine[];
  /** Paged mode: queue rows matching machine + search, over all pages. */
  total?: number;
}

/** ▲/▼ on one queue row (ADR-201): the SERVER swaps it with its neighbour in
 *  the machine's FULL queue, so a move on page 2 never disturbs other pages. */
export const moveJobQueueOpInputSchema = z.object({
  jcOpId: z.string().uuid(),
  dir: z.enum(['up', 'down']),
});
export type MoveJobQueueOpInput = z.infer<typeof moveJobQueueOpInputSchema>;

export const reorderJobQueueInputSchema = z.object({
  /** Ordered list of jc_op IDs in the new queue order for this machine. */
  jcOpIds: z.array(z.string().uuid()).min(1),
});
export type ReorderJobQueueInput = z.infer<typeof reorderJobQueueInputSchema>;
