// SO Status Review response shapes (PL-1).
//
// Single read endpoint: GET /so-status/:soId returns aggregated per-line +
// per-JC + per-op detail driving the Sales Order Status Review screen
// (legacy renderSOStatus HTML L4255). Read-only; no mutations live here.
//
// Per ADR-030: calc-engine.ts in apps/api/src/lib/ owns the rollup math;
// these schemas only describe the wire shape. Status enums on this page
// (op + JC + line) mirror the calc-engine's OpStatus / JcStatus / SoLineStatus
// types verbatim — kept as string literal unions to stay framework-agnostic.

import { z } from 'zod';

// Op status (from calc-engine OpStatus union)
export const soStatusOpStatusEnum = z.enum([
  'complete',
  'qc_pending',
  'running',
  'in_progress',
  'available',
  'waiting',
  'outsource_pending',
  'outsource_pr_raised',
  'outsource_po_created',
  'outsource_at_vendor',
  'outsource_received',
]);
export type SoStatusOpStatus = z.infer<typeof soStatusOpStatusEnum>;

export const soStatusOpSchema = z.object({
  id: z.string().uuid(),
  opSeq: z.number().int().positive(),
  operation: z.string(),
  opType: z.enum(['process', 'outsource', 'qc']),
  machineId: z.string().uuid().nullable(),
  machineCodeText: z.string().nullable(),
  qcRequired: z.boolean(),
  outsourceStatus: z
    .enum(['pending', 'pr_raised', 'po_created', 'sent', 'received'])
    .nullable(),
  outsourcePrId: z.string().uuid().nullable(),
  completed: z.number().int().nonnegative(),
  qcAccepted: z.number().int().nonnegative(),
  qcRejected: z.number().int().nonnegative(),
  qcPending: z.number().int().nonnegative(),
  inputAvail: z.number().int().nonnegative(),
  available: z.number().int().nonnegative(),
  running: z.boolean(),
  status: soStatusOpStatusEnum,
});
export type SoStatusOp = z.infer<typeof soStatusOpSchema>;

// JC rollup status (from calc-engine JcStatus union)
export const soStatusJcStatusEnum = z.enum([
  'complete',
  'qc_pending',
  'in_progress',
  'no_ops',
]);
export type SoStatusJcStatus = z.infer<typeof soStatusJcStatusEnum>;

export const soStatusJcSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  itemCode: z.string().nullable(),
  itemName: z.string().nullable(),
  orderQty: z.number().int().positive(),
  doneQty: z.number().int().nonnegative(),
  remainingQty: z.number().int().nonnegative(),
  completionPct: z.number().int().min(0).max(100),
  totalOps: z.number().int().nonnegative(),
  doneOps: z.number().int().nonnegative(),
  qcPendOps: z.number().int().nonnegative(),
  priority: z.string(),
  dueDate: z.string().nullable(),
  status: soStatusJcStatusEnum,
  /** Op rows in op_seq order. */
  ops: z.array(soStatusOpSchema),
});
export type SoStatusJc = z.infer<typeof soStatusJcSchema>;

// Per-line status badge (from calc-engine SoLineRollup.lineStatus)
export const soStatusLineStatusEnum = z.enum([
  'no_jc',
  'complete',
  'qc_pending',
  'in_progress',
]);
export type SoStatusLineStatus = z.infer<typeof soStatusLineStatusEnum>;

export const soStatusChipSchema = z.object({
  qty: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export type SoStatusChip = z.infer<typeof soStatusChipSchema>;

export const soStatusOutsourceAlertSchema = z.object({
  /** Across ALL outsource ops for this line — qty currently at the vendor. */
  atVendorQty: z.number().int().nonnegative(),
  /** # of outsource ops awaiting PR creation. */
  pendingPrCount: z.number().int().nonnegative(),
  /** # of outsource ops where PR raised but no PO yet. */
  prRaisedCount: z.number().int().nonnegative(),
});
export type SoStatusOutsourceAlert = z.infer<typeof soStatusOutsourceAlertSchema>;

export const soStatusLineSchema = z.object({
  id: z.string().uuid(),
  lineNo: z.number().int().positive(),
  clientPoLineNo: z.string().nullable(),
  itemCode: z.string().nullable(),
  itemCodeText: z.string().nullable(),
  partName: z.string().nullable(),
  orderQty: z.number().int().positive(),
  dueDate: z.string().nullable(),
  /** Derived rollup. */
  status: soStatusLineStatusEnum,
  doneQty: z.number().int().nonnegative(),
  remainingQty: z.number().int().nonnegative(),
  completionPct: z.number().int().min(0).max(100),
  /** Six status chips matching legacy header strip. */
  chips: z.object({
    jcIssued: soStatusChipSchema,
    poRaised: soStatusChipSchema,
    grnReceived: soStatusChipSchema,
    qcAccepted: soStatusChipSchema,
    produced: soStatusChipSchema,
    dispatched: soStatusChipSchema,
  }),
  outsourceAlert: soStatusOutsourceAlertSchema,
  /** Linked Job Cards, ordered by jc.code. */
  jobCards: z.array(soStatusJcSchema),
});
export type SoStatusLine = z.infer<typeof soStatusLineSchema>;

export const soStatusHeaderSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  type: z.enum(['component_manufacturing', 'equipment', 'with_material']),
  status: z.enum(['open', 'closed', 'dispatched', 'cancelled']),
  soDate: z.string(),
  dueDate: z.string().nullable(),
  customerName: z.string().nullable(),
  clientPoNo: z.string().nullable(),
  remarks: z.string().nullable(),
  bomMasterId: z.string().uuid().nullable(),
  bomStatus: z.string().nullable(),
  gstPercent: z.string(),
  /** Header-level rollup across all lines. */
  totalQty: z.number().int().nonnegative(),
  totalDoneQty: z.number().int().nonnegative(),
  overallCompletionPct: z.number().int().min(0).max(100),
});
export type SoStatusHeader = z.infer<typeof soStatusHeaderSchema>;

export const soStatusResponseSchema = z.object({
  generatedAt: z.string(),
  header: soStatusHeaderSchema,
  lines: z.array(soStatusLineSchema),
});
export type SoStatusResponse = z.infer<typeof soStatusResponseSchema>;
