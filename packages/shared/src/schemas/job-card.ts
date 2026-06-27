// Job Card read shapes (T-032).
//
// Read-only at this phase — JC writes still go through op-entry per Phase 3.
// This module surfaces JCs in a list view with:
//   - the derived per-JC status from `v_jc_status` (mirrors legacy
//     calcEngine().jcStatus, line 1718-1728)
//   - the source SO/JW line link from T-029d (`source_so_line_id` /
//     `source_jw_line_id` FKs added in 0008_phase4_jc_alters.sql)
//   - filters legacy users expect: status, machine (any op on this JC uses
//     this machine), operator (any op_log on this JC was logged by this
//     operator), date range, free-text search.
//
// JC detail (`GET /job-cards/:id`) returns the same row shape as the list
// item — no nested ops here. Op detail + writes live under `/op-entry/...`,
// which the JC list page links into directly.

import { z } from 'zod';
import { JC_COMPUTED_STATUSES } from '../enums/jc-computed-status';
import { JC_PRIORITIES } from '../enums/jc-priority';

export const jcComputedStatusSchema = z.enum(JC_COMPUTED_STATUSES);
export const jcPrioritySchema = z.enum(JC_PRIORITIES);

// ─── Read shape ───────────────────────────────────────────────────────────

/** Source SO line link, populated when `source_so_line_id` is non-null on
 *  the JC. Customer name is denormalised from the SO header. */
export const jobCardSourceSoLinkSchema = z.object({
  type: z.literal('so'),
  salesOrderId: z.string().uuid(),
  salesOrderLineId: z.string().uuid(),
  code: z.string(),
  lineNo: z.number().int().positive(),
  partName: z.string().nullable(),
});
export type JobCardSourceSoLink = z.infer<typeof jobCardSourceSoLinkSchema>;

export const jobCardSourceJwLinkSchema = z.object({
  type: z.literal('jw'),
  jobWorkOrderId: z.string().uuid(),
  jobWorkOrderLineId: z.string().uuid(),
  code: z.string(),
  lineNo: z.number().int().positive(),
  partName: z.string().nullable(),
});
export type JobCardSourceJwLink = z.infer<typeof jobCardSourceJwLinkSchema>;

export const jobCardSourceLinkSchema = z.discriminatedUnion('type', [
  jobCardSourceSoLinkSchema,
  jobCardSourceJwLinkSchema,
]);
export type JobCardSourceLink = z.infer<typeof jobCardSourceLinkSchema>;

export const jobCardListItemSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  code: z.string(),
  jcDate: z.string(), // ISO date
  itemId: z.string().uuid(),
  itemCode: z.string(),
  itemName: z.string(),
  orderQty: z.number().int().positive(),
  priority: jcPrioritySchema,
  dueDate: z.string().nullable(),
  drawingFilePath: z.string().nullable(),
  remarks: z.string().nullable(),
  closedAt: z.string().nullable(),
  // Derived from v_jc_status
  computedStatus: jcComputedStatusSchema,
  totalOps: z.number().int().nonnegative(),
  doneOps: z.number().int().nonnegative(),
  qcPendingOps: z.number().int().nonnegative(),
  // Source link (or null for source-less JCs — allowed per ADR-012 #4
  // CHECK num_nonnulls(...) <= 1)
  sourceLink: jobCardSourceLinkSchema.nullable(),
  // Legacy list columns (renderJobCards L5747-5773):
  //   - clientPoLineNo: from the source SO line (`sol.client_po_line_no`);
  //     null for JW-sourced or source-less JCs (JW lines have no CPO ref).
  //   - lastOpCompletedQty: completed qty of the highest-op_seq op, mirrors
  //     legacy `lastOp.completed` → drives the Completed/Pending columns.
  //   - runningCount: count of this JC's ops with an active running session.
  clientPoLineNo: z.string().nullable(),
  lastOpCompletedQty: z.number().int().nonnegative(),
  runningCount: z.number().int().nonnegative(),
  /** Customer name surfaced for the list view: prefers SO/JW source link's
   *  `customer_name`; falls back to the linked client's name when the source
   *  uses `client_id`. Null when no source link or no customer info at all. */
  customerName: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
});
export type JobCardListItem = z.infer<typeof jobCardListItemSchema>;

// ─── Query filters ────────────────────────────────────────────────────────

export const listJobCardsQuerySchema = z.object({
  /** Free-text match against jc.code, items.code, items.name,
   *  source SO/JW code, and source customerName. */
  search: z.string().min(1).max(100).optional(),
  status: jcComputedStatusSchema.optional(),
  /** Match any jc_op on this JC that uses this machine. */
  machineId: z.string().uuid().optional(),
  /** Match any op_log on this JC's ops that was logged by this operator. */
  operatorId: z.string().uuid().optional(),
  fromDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  toDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListJobCardsQuery = z.infer<typeof listJobCardsQuerySchema>;

export interface ListJobCardsResponse {
  items: JobCardListItem[];
  total: number;
  limit: number;
  offset: number;
}

// ─── Write shapes (parity: addJC L6020 / editJC L6076 / jcModalBody L5943) ──
//
// Mirror of the legacy JC create/edit modal. Machine + outsource vendor are
// chosen by CODE in the modal (datalist) and resolved to IDs server-side, with
// the code kept as a text fallback (jc_ops.machine_code_text /
// outsource_vendor_text). QC documents register into the unified file_registry
// (ADR-047) linked to the new JC. Drawing is uploaded to Storage first; only its
// path travels in the payload. See ADR-051.

/** One operation routing row. opType drives which fields apply:
 *  - process : machineCode + operation required (in-house machining step)
 *  - outsource: outsourceVendorCode required; machine optional
 *  - qc      : QC inspection step; operation = QC process name; no machine
 *  (Legacy auto-classified some process ops to 'OSP' from the operation name;
 *   in this system OSP is handled at op-entry start via the osp_processes
 *   cascade, not at JC create, and jc_ops.op_type has no 'osp' value.) */
export const JC_OP_INPUT_TYPES = ['process', 'qc', 'outsource'] as const;
export const jcOpInputTypeSchema = z.enum(JC_OP_INPUT_TYPES);
export type JcOpInputType = z.infer<typeof jcOpInputTypeSchema>;

export const jcOpInputSchema = z.object({
  /** Present when editing an existing op — preserved so op_log stays linked. */
  id: z.string().uuid().optional(),
  /** machines.code; resolved to machine_id server-side (text kept as fallback). */
  machineCode: z.string().max(64).nullable().optional(),
  operation: z.string().min(1, 'Operation name is required').max(255),
  opType: jcOpInputTypeSchema.default('process'),
  cycleTimeMin: z.coerce.number().nonnegative().default(0),
  program: z.string().max(255).nullable().optional(),
  toolNo: z.string().max(120).nullable().optional(),
  toolDetails: z.string().max(2000).nullable().optional(),
  qcRequired: z.boolean().default(false),
  /** vendors.code; resolved to outsource_vendor_id server-side. */
  outsourceVendorCode: z.string().max(64).nullable().optional(),
  outsourceCost: z.coerce.number().nonnegative().default(0),
});
export type JcOpInput = z.infer<typeof jcOpInputSchema>;

/** A QC document to register into file_registry against the JC (category
 *  'qc-docs'). The file is uploaded to Storage by the client first. */
export const jcDocInputSchema = z.object({
  docType: z.string().min(1).max(120),
  docName: z.string().max(255).nullable().optional(),
  fileName: z.string().min(1).max(255),
  storagePath: z.string().min(1).max(512),
  fileSize: z.number().int().nonnegative().nullable().optional(),
});
export type JcDocInput = z.infer<typeof jcDocInputSchema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const jobCardWriteInputSchema = z
  .object({
    jcDate: isoDate,
    /** At most one source link (mirrors the CHECK num_nonnulls(...) <= 1). */
    sourceSoLineId: z.string().uuid().nullable().optional(),
    sourceJwLineId: z.string().uuid().nullable().optional(),
    /** items.code — resolved to item_id server-side (must exist in Item Master). */
    itemCode: z.string().min(1, 'Item Code is required').max(64),
    orderQty: z.coerce.number().int().positive('Order Qty must be greater than 0'),
    priority: jcPrioritySchema.default('normal'),
    dueDate: isoDate.nullable().optional(),
    drawingFilePath: z.string().max(512).nullable().optional(),
    remarks: z.string().max(2000).nullable().optional(),
    ops: z.array(jcOpInputSchema).default([]),
    qcDocs: z.array(jcDocInputSchema).default([]),
  })
  .refine((d) => !(d.sourceSoLineId && d.sourceJwLineId), {
    message: 'A Job Card can link to at most one SO or JW line',
    path: ['sourceJwLineId'],
  });
export type JobCardWriteInput = z.infer<typeof jobCardWriteInputSchema>;

// Create and edit submit the same shape (JC No. is auto-generated on create and
// immutable on edit, so it never travels in the payload).
export const jobCardCreateInputSchema = jobCardWriteInputSchema;
export type JobCardCreateInput = JobCardWriteInput;
export const jobCardUpdateInputSchema = jobCardWriteInputSchema;
export type JobCardUpdateInput = JobCardWriteInput;

// ─── Cascade source options (parity: CASCADE.allOpenOrders + orderBalance) ──
// Open SO + JW lines a new JC can be raised against, each with its JC-allocated
// balance. Drives the modal's "SO / WO / JW No." search + auto-fill + balance
// banner (legacy _jcCascadeFromOrder L1874).
export const jobCardSourceOptionSchema = z.object({
  type: z.enum(['so', 'jw']),
  orderId: z.string().uuid(),
  lineId: z.string().uuid(),
  code: z.string(),
  lineNo: z.number().int(),
  partName: z.string().nullable(),
  itemCode: z.string().nullable(),
  customerName: z.string().nullable(),
  orderQty: z.number().int(),
  dueDate: z.string().nullable(),
  clientPoLineNo: z.string().nullable(),
  /** Σ order_qty of active JCs already on this line. */
  inJc: z.number().int().nonnegative(),
  /** max(0, orderQty − inJc). */
  remaining: z.number().int(),
});
export type JobCardSourceOption = z.infer<typeof jobCardSourceOptionSchema>;

// ─── Edit model (repopulates the create/edit modal with the full op detail) ──
// Op routing rows carry every editable field (the op-entry enriched read omits
// program/tool/cost) plus `hasStarted` so the form can lock started ops.
export const jobCardOpEditSchema = z.object({
  id: z.string().uuid(),
  opSeq: z.number().int(),
  machineCode: z.string().nullable(),
  operation: z.string(),
  opType: jcOpInputTypeSchema,
  cycleTimeMin: z.number().nonnegative(),
  program: z.string().nullable(),
  toolNo: z.string().nullable(),
  toolDetails: z.string().nullable(),
  qcRequired: z.boolean(),
  outsourceVendorCode: z.string().nullable(),
  outsourceCost: z.number().nonnegative(),
  hasStarted: z.boolean(),
});
export type JobCardOpEdit = z.infer<typeof jobCardOpEditSchema>;

export const jobCardDocSchema = z.object({
  id: z.string().uuid(),
  docType: z.string(),
  fileName: z.string(),
  storagePath: z.string(),
  fileSize: z.number().int().nullable(),
});
export type JobCardDoc = z.infer<typeof jobCardDocSchema>;

export const jobCardEditModelSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  jcDate: z.string(),
  sourceSoLineId: z.string().uuid().nullable(),
  sourceJwLineId: z.string().uuid().nullable(),
  itemCode: z.string(),
  orderQty: z.number().int(),
  priority: jcPrioritySchema,
  dueDate: z.string().nullable(),
  drawingFilePath: z.string().nullable(),
  remarks: z.string().nullable(),
  ops: z.array(jobCardOpEditSchema),
  qcDocs: z.array(jobCardDocSchema),
});
export type JobCardEditModel = z.infer<typeof jobCardEditModelSchema>;
