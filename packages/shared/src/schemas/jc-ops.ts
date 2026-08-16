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
import { machineSplitSchema } from './machine-split';

export const jcOpsBoardRowSchema = z.object({
  jcOpId: z.string().uuid(),
  jcId: z.string().uuid().nullable(),
  jcCode: z.string(),
  jcItemCode: z.string().nullable(),
  jcItemName: z.string().nullable(),
  jcOrderQty: z.number().int().nonnegative(),
  opSeq: z.number().int().positive(),
  operation: z.string(),
  /** The machine the REMAINING qty runs on. Not who made `completed` — an op
   *  re-routed mid-flight has produced pieces on other machines (ADR-126). */
  machineId: z.string().uuid().nullable(),
  machineCode: z.string().nullable(),
  /** Who actually made `completed`, per machine (ADR-126). See machineSplitSchema. */
  machines: machineSplitSchema,
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

// Outsource-balance action (ADR-081 dual-lane): outsource the remaining qty of
// an in-progress in-house PROCESS op. `qty` must be ≤ the op's `available`;
// `vendorCode` is resolved against the vendors master and stamped on the op.
export const outsourceOpBalanceInputSchema = z.object({
  qty: z.number().int().positive(),
  vendorCode: z.string().trim().min(1),
});
export type OutsourceOpBalanceInput = z.infer<typeof outsourceOpBalanceInputSchema>;
