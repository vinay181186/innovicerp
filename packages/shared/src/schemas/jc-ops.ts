// JC Operations shared schemas (Production slice D).
//
// Flat list of all JC ops across all JCs with calc-engine status enrichment.
// Mirrors legacy renderJCOps (HTML L11349).
//
// Note: name-mangled with `JcOpsBoard*` prefix because the shared package
// barrels via `export *` and op-entry.ts already exports `listJcOpsQuerySchema`
// for a different (operator-facing) feature. See memory
// feedback_shared_schema_name_collisions.

import { z } from 'zod';

export const jcOpsBoardRowSchema = z.object({
  jcOpId: z.string().uuid(),
  jcId: z.string().uuid().nullable(),
  jcCode: z.string(),
  jcItemCode: z.string().nullable(),
  jcItemName: z.string().nullable(),
  jcOrderQty: z.number().int().nonnegative(),
  opSeq: z.number().int().positive(),
  operation: z.string(),
  machineId: z.string().uuid().nullable(),
  machineCode: z.string().nullable(),
  cycleTime: z.number(),
  qcRequired: z.boolean(),
  /** op type: process | outsource | qc */
  opType: z.string(),
  inputAvail: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  qcAccepted: z.number().int().nonnegative(),
  qcPending: z.number().int().nonnegative(),
  available: z.number().int().nonnegative(),
  pendingHrs: z.number(),
  /** 11-state enum from calc-engine. */
  status: z.string(),
  /** Outsource sub-status only for opType='outsource'. */
  outsourceStatus: z.string().nullable(),
  outsourceVendorCode: z.string().nullable(),
  outsourceVendorName: z.string().nullable(),
  outsourcePrCode: z.string().nullable(),
  outsourcePoCode: z.string().nullable(),
  /** PO PK for the deep-link to /purchase-orders/$id (legacy viewPO, L11371). */
  outsourcePoId: z.string().uuid().nullable(),
  sentQty: z.number().int().nonnegative(),
});
export type JcOpsBoardRow = z.infer<typeof jcOpsBoardRowSchema>;

export const listJcOpsBoardQuerySchema = z.object({
  jcCode: z.string().min(1).max(64).optional(),
  search: z.string().min(1).max(100).optional(),
  limit: z.coerce.number().int().positive().max(2000).default(500),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListJcOpsBoardQuery = z.infer<typeof listJcOpsBoardQuerySchema>;

export interface ListJcOpsBoardResponse {
  items: JcOpsBoardRow[];
  total: number;
  limit: number;
  offset: number;
  /** Distinct JC codes for the filter dropdown. */
  jcOptions: Array<{ jcId: string; jcCode: string }>;
}

export const changeJcOpMachineInputSchema = z.object({
  machineId: z.string().uuid(),
});
export type ChangeJcOpMachineInput = z.infer<typeof changeJcOpMachineInputSchema>;
