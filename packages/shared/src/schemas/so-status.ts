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
import { BOM_LINE_TYPES } from '../enums/bom-line-type';
import { soCustomerPartFiguresSchema } from './so-customer-part';
import { SO_STATUSES } from '../enums/so-status';

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
  /** The customer's drawing revision, read live off `sales_order_lines.revision`
   *  on the SO line this job card was raised against (`job_cards.source_so_line_id`).
   *  Null when the card has no SO line behind it — a JW-sourced or standalone card,
   *  or a line since deleted — and null must render as the bare item code, never a
   *  trailing slash and never `items.revision`, which is a different column about
   *  the item master and would be a plausible-looking lie on every row. */
  itemRevision: z.string().nullable().default(null),
  /** The customer's PO line number (`POL`) for the SO line this row traces back
   *  to, shown beside the item code on every downstream document (user rule,
   *  2026-09-23). Null when no SO line sits behind the row. Read-only — the
   *  Sales Order is the only place it is typed. */
  clientPoLineNo: z.string().nullable().default(null),
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
  // PO / GRN / QC chips carry purchase qty — decimal on KGS / MTR since 0172.
  qty: z.number().nonnegative(),
  total: z.number().nonnegative(),
  /** ADR-320 — false = "Not required": the line has no outsourced operation,
   *  so PO Raised / GRN Received / QC Accepted do not apply. Always true on the
   *  other three chips. */
  required: z.boolean().default(true),
});
export type SoStatusChip = z.infer<typeof soStatusChipSchema>;

/** ADR-320 — where one outsourced operation's PO stands, for the hover. */
export const SO_STATUS_OSP_PO_STATES = ['approved', 'reapproval', 'draft', 'none'] as const;
export const soStatusOspPoStateEnum = z.enum(SO_STATUS_OSP_PO_STATES);
export type SoStatusOspPoState = z.infer<typeof soStatusOspPoStateEnum>;

/** ADR-320 — one outsourced operation of one job card on the line. The line's
 *  PO Raised / GRN Received / QC Accepted chips are the LOWEST of these
 *  (a piece is covered only when every outsourced operation is). */
export const soStatusOspOpSchema = z.object({
  jcId: z.string().uuid(),
  jcCode: z.string(),
  jcOpId: z.string().uuid(),
  opSeq: z.number().int().positive(),
  operation: z.string(),
  /** Σ approved qty of this op's live PO lines (purchase_order_lines.approved_qty;
   *  a PO waiting re-approval keeps its last approved qty). Capped at the JC qty. */
  approvedPoQty: z.number().nonnegative(),
  /** Σ qty on draft PO lines never approved — shown, never counted. */
  draftPoQty: z.number().nonnegative(),
  poState: soStatusOspPoStateEnum,
  /** PO codes behind this op (live POs only), for the hover. */
  poCodes: z.array(z.string()),
  /** Σ GRN received on this op's approved PO lines, capped at approvedPoQty. */
  grnReceivedQty: z.number().nonnegative(),
  /** Σ Incoming QC accepted on those GRN lines, capped at grnReceivedQty. */
  qcAcceptedQty: z.number().nonnegative(),
});
export type SoStatusOspOp = z.infer<typeof soStatusOspOpSchema>;

/** Per-op handle for the "Raise PR for Op <N>" action on the SO Status
 *  detail (PL-1b §2.3). The web raises the PR through the JC Ops flow:
 *  POST /op-entry/osp-pr { jcOpId } (op-entry generateOspPr). */
export const soStatusPendingOsPrOpSchema = z.object({
  jcId: z.string().uuid(),
  jcCode: z.string(),
  opSeq: z.number().int().positive(),
  operation: z.string(),
  /** The jc_ops row id — the `jcOpId` POST /op-entry/osp-pr takes. */
  jcOpId: z.string().uuid().optional(),
  /** The op's stored outsource_status — one of 'pending' | 'pr_raised' |
   *  'po_created' | 'sent' | 'received'; null when unset. */
  outsourceStatus: z.string().nullable().optional(),
});
export type SoStatusPendingOsPrOp = z.infer<typeof soStatusPendingOsPrOpSchema>;

export const soStatusOutsourceAlertSchema = z.object({
  /** Across ALL outsource ops for this line — qty currently at the vendor. */
  atVendorQty: z.number().int().nonnegative(),
  /** # of outsource ops currently at the vendor (status Sent or PO Created).
   *  Lets the UI render "<atVendorQty> pcs across <N> outsource op(s)". */
  atVendorOpCount: z.number().int().nonnegative(),
  /** # of outsource ops awaiting PR creation. */
  pendingPrCount: z.number().int().nonnegative(),
  /** # of outsource ops where PR raised but no PO yet. */
  prRaisedCount: z.number().int().nonnegative(),
  /** Per-op handles for the pending OSP ops — drives the inline PR buttons
   *  inside the JC ops chip strip (PL-1b §2.3). */
  pendingOps: z.array(soStatusPendingOsPrOpSchema),
});
export type SoStatusOutsourceAlert = z.infer<typeof soStatusOutsourceAlertSchema>;

export const soStatusLineSchema = z.object({
  id: z.string().uuid(),
  lineNo: z.number().int().positive(),
  clientPoLineNo: z.string().nullable(),
  itemCode: z.string().nullable(),
  /** The customer's drawing revision typed on this very SO line
   *  (`sales_order_lines.revision`, migration 0119). Nullable only because a
   *  database that has not had 0119 has nothing to give; on a migrated one every
   *  line carries a value. Never `items.revision` — a different column about the
   *  item itself. */
  itemRevision: z.string().nullable().default(null),
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
  /** ADR-320 — every outsourced operation behind the PO / GRN / QC chips,
   *  ordered by JC then op. Empty = "Not required". */
  ospOps: z.array(soStatusOspOpSchema).default([]),
  /** Linked Job Cards, ordered by jc.code. */
  jobCards: z.array(soStatusJcSchema),
});
export type SoStatusLine = z.infer<typeof soStatusLineSchema>;

/** Equipment-SO banner data (PL-1b §1.1). Present when SO type=equipment
 *  AND a BOM master is linked at the SO header level. Drives the BOM-status
 *  badge + linked-BOM chip + the "📦 Plan BOM Items" entry point. */
export const soStatusEquipmentInfoSchema = z.object({
  equipmentItemCode: z.string().nullable(),
  equipmentItemName: z.string().nullable(),
  equipmentQty: z.number().int().nonnegative(),
  bomNo: z.string().nullable(),
  bomRev: z.number().int().nullable(),
  bomName: z.string().nullable(),
  bomPartsCount: z.number().int().nonnegative(),
});
export type SoStatusEquipmentInfo = z.infer<typeof soStatusEquipmentInfoSchema>;

export const soStatusHeaderSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  /** ADR-207 Internal SO No. (live from sales_orders); null on old SOs. */
  internalSoNo: z.string().nullable().optional(),
  type: z.enum(['component_manufacturing', 'equipment', 'with_material']),
  status: z.enum(SO_STATUSES),
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
  /** Only set when type === 'equipment'. Null otherwise. */
  equipmentInfo: soStatusEquipmentInfoSchema.nullable(),
});
export type SoStatusHeader = z.infer<typeof soStatusHeaderSchema>;

/** BOM child row for the Equipment-SO BOM items table (PL-1b §3).
 *  Same shape as PL-4b's PlanningBomChild but redeclared here to keep
 *  so-status.ts self-contained for consumers. */
export const soStatusBomItemSchema = z.object({
  childItemId: z.string().uuid(),
  childItemCode: z.string(),
  childItemName: z.string(),
  qtyPerSet: z.number().nonnegative(),
  totalNeed: z.number().nonnegative(),
  stockQty: z.number().nonnegative(),
  shortfall: z.number().nonnegative(),
  bomType: z.enum(BOM_LINE_TYPES),
  /** ADR-307: set only on a party_supplied row; then `stockQty` = figures.inStoreQty
   *  and `shortfall` = figures.shortQty (company stock ignored). */
  customerPart: soCustomerPartFiguresSchema.nullable().default(null),
  /** Plan-status label + linked JC code, if a plan covers this child. */
  planStatus: z.string().nullable(),
  planCode: z.string().nullable(),
  jcCode: z.string().nullable(),
});
export type SoStatusBomItem = z.infer<typeof soStatusBomItemSchema>;

export const soStatusResponseSchema = z.object({
  generatedAt: z.string(),
  header: soStatusHeaderSchema,
  lines: z.array(soStatusLineSchema),
  /** Only populated when the SO is an Equipment SO with a linked BOM master
   *  and that BOM has children. [] otherwise. */
  bomItems: z.array(soStatusBomItemSchema),
});
export type SoStatusResponse = z.infer<typeof soStatusResponseSchema>;
