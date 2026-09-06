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
  /** PR PK, for the "Gen PO" next-action link on the JC op card
   *  (/purchase-orders/from-pr?prId=). The code alone cannot address that
   *  screen. Read straight off jc_ops.outsource_pr_id, which every outsource op
   *  carries: the OSP purchase request is raised AUTOMATICALLY -- on Job Card
   *  save (job-cards/service.ts, "Auto OSP PR on JC edit"), on Plan execute,
   *  and on the ADR-081 in-house->OSP switch -- so an outsource op is born at
   *  `pr_raised` and `pending` is never reached. */
  outsourcePrId: z.string().uuid().nullable(),
  /** The outward challan this op is WAITING TO RECEIVE BACK, if any: the oldest
   *  still-`issued` DC raised against the op's PO line. Drives the "Receive"
   *  next-action link (/delivery-challans/$id/receive), which is also what
   *  books the GRN -- so the card never needs a separate "Gen GRN" affordance
   *  (GRN sits in the Store department, which shop-floor users rarely hold).
   *  Oldest-first because material goes out and comes back in the order it was
   *  sent. Null once every challan is received or cancelled.
   *
   *  IN-JC-26-00008 op 8 is the case that shapes this: three challans on one op
   *  -- IN-DC-00002 received, IN-DC-00006 cancelled, IN-DC-00007 issued -- and
   *  only the last is receivable. */
  outsourceOpenDcId: z.string().uuid().nullable(),
  /** Code of `outsourceOpenDcId`, so the link can name the challan it opens. */
  outsourceOpenDcCode: z.string().nullable(),
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
