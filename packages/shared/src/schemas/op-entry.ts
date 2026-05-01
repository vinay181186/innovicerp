// Op Entry shared schemas (T-025).
//
// Mirrors the legacy "Op Entry" + "Machine Op Entry" screens (legacy lines
// 5400-5734) on top of the Phase 3 storage layer (job_cards, jc_ops, op_log,
// running_ops + the v_jc_op_status / v_jc_status views).
//
// Three distinct shapes:
//   - read: jc_ops enriched with computed_status from v_jc_op_status, op_log
//     rows for history, running_ops for the live operations board.
//   - write: submit completion (POST /op-entry/op-log), start op (POST
//     /op-entry/start), stop op (POST /op-entry/running-ops/:id/stop).
//   - query: filter params for the lists.

import { z } from 'zod';
import { OP_LOG_TYPES } from '../enums/op-log-type';
import { OP_TYPES } from '../enums/op-type';
import { OUTSOURCE_STATUSES } from '../enums/outsource-status';
import { RUNNING_OP_STATUSES } from '../enums/running-op-status';
import { SHIFTS } from '../enums/shift';

export const opTypeSchema = z.enum(OP_TYPES);
export const opLogTypeSchema = z.enum(OP_LOG_TYPES);
export const outsourceStatusSchema = z.enum(OUTSOURCE_STATUSES);
export const runningOpStatusSchema = z.enum(RUNNING_OP_STATUSES);
export const shiftSchema = z.enum(SHIFTS);

// Computed status from v_jc_op_status. Mirrors calcEngine's enrichedOps.status
// (legacy line 1682-1697). Twelve values: 6 normal + 6 outsource sub-states.
export const COMPUTED_JC_OP_STATUSES = [
  'waiting',
  'available',
  'in_progress',
  'running',
  'qc_pending',
  'complete',
  'pr_raised',
  'po_created',
  'at_vendor',
  'received',
  'ready_for_pr',
  'outsource',
] as const;
export type ComputedJcOpStatus = (typeof COMPUTED_JC_OP_STATUSES)[number];
export const computedJcOpStatusSchema = z.enum(COMPUTED_JC_OP_STATUSES);

// ─── Read shapes ───────────────────────────────────────────────────────────

export const jcOpEnrichedSchema = z.object({
  // From jc_ops
  id: z.string().uuid(),
  jobCardId: z.string().uuid(),
  jobCardCode: z.string(), // joined from job_cards.code
  opSeq: z.number().int().positive(),
  machineId: z.string().uuid().nullable(),
  machineCode: z.string().nullable(), // joined from machines.code; null for OSP / QC
  machineCodeText: z.string().nullable(),
  operation: z.string(),
  opType: opTypeSchema,
  cycleTimeMin: z.string(), // numeric stored as string
  qcRequired: z.boolean(),
  qcCallDate: z.string().nullable(),
  qcAttendedDate: z.string().nullable(),
  reworkQty: z.number().int().nonnegative(),
  outsourceVendorId: z.string().uuid().nullable(),
  outsourceStatus: outsourceStatusSchema.nullable(),
  // From v_jc_op_status (computed)
  completedQty: z.number().int().nonnegative(),
  qcAcceptedQty: z.number().int().nonnegative(),
  qcRejectedQty: z.number().int().nonnegative(),
  inputAvail: z.number().int().nonnegative(),
  available: z.number().int().nonnegative(),
  qcPending: z.number().int().nonnegative(),
  computedStatus: computedJcOpStatusSchema,
});
export type JcOpEnriched = z.infer<typeof jcOpEnrichedSchema>;

export const opLogSchema = z.object({
  id: z.string().uuid(),
  jcOpId: z.string().uuid(),
  logNo: z.string(),
  logType: opLogTypeSchema,
  logDate: z.string(), // ISO date
  shift: shiftSchema,
  qty: z.number().int().nonnegative(),
  rejectQty: z.number().int().nonnegative(),
  operatorId: z.string().uuid().nullable(),
  operatorName: z.string().nullable(),
  startTime: z.string().nullable(), // HH:MM:SS
  remarks: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
});
export type OpLog = z.infer<typeof opLogSchema>;

export const runningOpSchema = z.object({
  id: z.string().uuid(),
  jcOpId: z.string().uuid(),
  jobCardCode: z.string(), // joined
  opSeq: z.number().int().positive(), // joined
  operation: z.string(), // joined
  machineId: z.string().uuid().nullable(),
  machineCode: z.string().nullable(), // joined
  isOsp: z.boolean(),
  operatorId: z.string().uuid().nullable(),
  operatorName: z.string().nullable(),
  startDate: z.string(),
  startTime: z.string(),
  shift: shiftSchema,
  status: runningOpStatusSchema,
  endedAt: z.string().nullable(),
});
export type RunningOp = z.infer<typeof runningOpSchema>;

// ─── Write inputs ──────────────────────────────────────────────────────────

export const submitOpLogInputSchema = z.object({
  jcOpId: z.string().uuid(),
  qty: z.number().int().positive(), // submit must be > 0; 'start' uses startOp
  rejectQty: z.number().int().nonnegative().default(0),
  logDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shift: shiftSchema,
  operatorId: z.string().uuid().optional(),
  operatorName: z.string().min(1).max(120).optional(),
  remarks: z.string().max(500).optional(),
});
export type SubmitOpLogInput = z.infer<typeof submitOpLogInputSchema>;

export const startOpInputSchema = z.object({
  jcOpId: z.string().uuid(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{1,2}:\d{2}(:\d{2})?$/),
  shift: shiftSchema,
  operatorId: z.string().uuid().optional(),
  operatorName: z.string().min(1).max(120).optional(),
  remarks: z.string().max(500).optional(),
});
export type StartOpInput = z.infer<typeof startOpInputSchema>;

// ─── Query filters ─────────────────────────────────────────────────────────

export const listJcOpsQuerySchema = z.object({
  jobCardId: z.string().uuid().optional(),
  jobCardCode: z.string().min(1).max(64).optional(),
});
export type ListJcOpsQuery = z.infer<typeof listJcOpsQuerySchema>;

export const listOpLogQuerySchema = z.object({
  jcOpId: z.string().uuid(),
  limit: z.coerce.number().int().positive().max(500).default(100),
});
export type ListOpLogQuery = z.infer<typeof listOpLogQuerySchema>;

export const listRunningOpsQuerySchema = z.object({
  status: runningOpStatusSchema.optional(),
});
export type ListRunningOpsQuery = z.infer<typeof listRunningOpsQuerySchema>;
