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
import { OP_LOG_CHANGE_STATUSES } from '../enums/op-log-change-status';
import { OP_LOG_TYPES } from '../enums/op-log-type';
import { OP_TYPES } from '../enums/op-type';
import { OUTSOURCE_STATUSES } from '../enums/outsource-status';
import { RUNNING_OP_STATUSES } from '../enums/running-op-status';
import { SHIFTS } from '../enums/shift';
import { machineSplitSchema } from './machine-split';

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
  soCode: z.string().nullable().optional(), // source SO/JW order code (T27)
  opSeq: z.number().int().positive(),
  machineCode: z.string().nullable(), // joined from machines.code; null for OSP / QC
  machineCodeText: z.string().nullable(),
  /** Who actually MADE the completed qty, per machine (ADR-126). The two machine
   *  fields above are the op's CURRENT machine — where the REMAINING qty runs —
   *  so on a re-routed op they name a machine that may have produced nothing.
   *  See machineSplitSchema. */
  machines: machineSplitSchema,
  operation: z.string(),
  opType: opTypeSchema,
  cycleTimeMin: z.string(), // numeric stored as string
  program: z.string().nullable(),
  toolNo: z.string().nullable(),
  qcRequired: z.boolean(),
  /** Running total ever RAISED against this op by an NC rework disposition.
   *  Audit trail only — it never decrements. Show `reworkPendingQty` instead. */
  reworkQty: z.number().int().nonnegative(),
  outsourceStatus: outsourceStatusSchema.nullable(),
  // From v_jc_op_status (computed)
  completedQty: z.number().int().nonnegative(),
  qcAcceptedQty: z.number().int().nonnegative(),
  qcRejectedQty: z.number().int().nonnegative(),
  inputAvail: z.number().int().nonnegative(),
  available: z.number().int().nonnegative(),
  /** Outsource pieces physically at the vendor (sent − received); 0 otherwise. */
  atVendorQty: z.number().int().nonnegative(),
  /** Outsource pieces that may go to the vendor RIGHT NOW; 0 otherwise.
   *
   *  `pendingQty` on an outsource op is the whole un-done balance and counts
   *  pieces already sitting at the vendor. This does not: it is
   *  `input_avail − done in-house − already sent`, read from v_osp_wip so the
   *  card, the OSP register and the outward-challan guard all use ONE formula.
   *  JC-9 op 3: upstream cleared 11, 10 already sent → 1. */
  readyToSendQty: z.number().int().nonnegative(),
  /** Outsource pieces returned but incoming-QC still pending (received − accepted − rejected); 0 otherwise. */
  inQcQty: z.number().int().nonnegative(),
  qcPending: z.number().int().nonnegative(),
  /** THE number every screen labels "Pending" (0087). QC op → qc_pending (a
   *  reject resolves a piece just as an accept does); every other op →
   *  available. Computed in v_jc_op_status so the JC card, the Op Entry table
   *  and the QC dashboards can never disagree about the same op again. */
  pendingQty: z.number().int().nonnegative(),
  /** Pieces this op still OWES rework on (0088) — summed live from the NC
   *  register, so it falls to 0 when the NC is closed. This is the ♻ marker. */
  reworkPendingQty: z.number().int().nonnegative(),
  /** Pieces THIS op rejected that are currently out for rework (0090) — the
   *  mirror of reworkPendingQty, seen from the op that found the fault. */
  reworkRaisedQty: z.number().int().nonnegative(),
  /** Which op seq(s) those pieces went back to, e.g. "1" or "1, 3". Null when
   *  reworkRaisedQty is 0. */
  reworkRaisedToOps: z.string().nullable(),
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
  /** The machine this entry's qty was produced on (0095). Stamped at log time,
   *  so it survives a later machine change on the operation. Null on QC entries
   *  and on pre-0095 rows whose op never carried a resolved machine. */
  machineId: z.string().uuid().nullable(),
  /** Live machines-master code (LEFT JOIN on machineId); prefer over the
   *  machineCodeText snapshot, which can drift from the master. */
  machineCode: z.string().nullable(),
  machineCodeText: z.string().nullable(),
  startTime: z.string().nullable(), // HH:MM:SS
  remarks: z.string().nullable(),
  /** When this entry's date/time was last corrected (0097). Null = as recorded.
   *  Only the timestamp is ever editable — qty is immutable, so an edited row's
   *  numbers still match what the operator originally submitted. */
  timingEditedAt: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
});
export type OpLog = z.infer<typeof opLogSchema>;

/** Correct WHEN an entry happened — never WHAT it recorded (ADR-127).
 *  The only mutation op_log accepts; enforced column-by-column by the DB
 *  trigger op_log_timing_only_update, not just by this schema. */
export const updateOpLogTimingInputSchema = z.object({
  id: z.string().uuid(),
  logDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** HH:MM. Omit to leave the recorded time alone; null to clear it. */
  logTime: z
    .string()
    .regex(/^\d{1,2}:\d{2}(:\d{2})?$/)
    .nullable()
    .optional(),
  /** Why the correction is needed. Shown to the approver (ADR-130). */
  reason: z.string().max(500).optional(),
});
export type UpdateOpLogTimingInput = z.infer<typeof updateOpLogTimingInputSchema>;

// ─── Timing-change approval (ADR-130, table op_log_time_change_requests) ────
//
// The operator's edit does NOT apply on save. It becomes a request; the entry
// and every number derived from it keep their original values until a manager
// approves. Approving performs the ADR-127 update; rejecting performs nothing.

export const opLogChangeStatusSchema = z.enum(OP_LOG_CHANGE_STATUSES);

export const opLogTimeChangeRequestSchema = z.object({
  id: z.string().uuid(),
  opLogId: z.string().uuid(),
  jcOpId: z.string().uuid(),
  /** Context for the approver, joined from the entry and its operation — none
   *  of it is stored on the request row. */
  jobCardCode: z.string(),
  opSeq: z.number().int().positive(),
  operation: z.string(),
  logType: opLogTypeSchema,
  machineCode: z.string().nullable(),
  /** The entry's qty, shown so the approver can see it is NOT part of the ask. */
  qty: z.number().int().nonnegative(),
  rejectQty: z.number().int().nonnegative(),
  prevLogDate: z.string(),
  prevStartTime: z.string().nullable(),
  requestedLogDate: z.string(),
  requestedStartTime: z.string().nullable(),
  reason: z.string().nullable(),
  status: opLogChangeStatusSchema,
  requestedBy: z.string().uuid(),
  requestedByName: z.string().nullable(),
  requestedAt: z.string(),
  decidedBy: z.string().uuid().nullable(),
  decidedByName: z.string().nullable(),
  decidedAt: z.string().nullable(),
  decisionReason: z.string().nullable(),
  /** True when the entry has been retimed since this request was raised, so the
   *  "was" value on screen no longer matches the row. Approving is still safe
   *  (it writes the requested value) but the approver should see it. */
  isStale: z.boolean(),
});
export type OpLogTimeChangeRequest = z.infer<typeof opLogTimeChangeRequestSchema>;

export const listOpLogTimeChangeRequestsQuerySchema = z.object({
  status: opLogChangeStatusSchema.optional(),
  /** All requests against one entry — drives the ⏳ marker in the log history. */
  jcOpId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
});
export type ListOpLogTimeChangeRequestsQuery = z.infer<
  typeof listOpLogTimeChangeRequestsQuerySchema
>;

export const decideOpLogTimeChangeInputSchema = z
  .object({
    id: z.string().uuid(),
    decision: z.enum(['approve', 'reject']),
    /** Required on a reject — without one the requester just asks again. */
    decisionReason: z.string().max(500).optional(),
  })
  .refine((i) => i.decision === 'approve' || Boolean(i.decisionReason?.trim()), {
    message: 'A reason is required when rejecting a change',
    path: ['decisionReason'],
  });
export type DecideOpLogTimeChangeInput = z.infer<typeof decideOpLogTimeChangeInputSchema>;

/** What `PATCH /op-entry/op-log/:id/timing` returns. `applied: false` means the
 *  entry is unchanged and `request` holds what is now waiting for a manager. */
export const updateOpLogTimingResultSchema = z.object({
  applied: z.boolean(),
  opLog: opLogSchema,
  request: opLogTimeChangeRequestSchema.nullable(),
});
export type UpdateOpLogTimingResult = z.infer<typeof updateOpLogTimingResultSchema>;

// ─── Machine-wise output (0095, view v_op_machine_output) ──────────────────
//
// THE answer to "qty wise machine used": one row per (operation × machine).
// Reads only log_type='complete' rows with qty > 0, so 'start' markers and QC
// inspections never inflate it.

export const opMachineOutputSchema = z.object({
  jcOpId: z.string().uuid(),
  jobCardId: z.string().uuid(),
  opSeq: z.number().int().positive(),
  machineId: z.string().uuid().nullable(),
  machineCode: z.string(),
  machineName: z.string().nullable(),
  completedQty: z.number().int().nonnegative(),
  rejectQty: z.number().int().nonnegative(),
  entryCount: z.number().int().nonnegative(),
  firstLogDate: z.string(),
  lastLogDate: z.string(),
});
export type OpMachineOutput = z.infer<typeof opMachineOutputSchema>;

export const listOpMachineOutputQuerySchema = z
  .object({
    jcOpId: z.string().uuid().optional(),
    /** Every op of a whole Job Card — drives the JC-level machine breakdown. */
    jobCardId: z.string().uuid().optional(),
  })
  .refine((q) => Boolean(q.jcOpId || q.jobCardId), {
    message: 'Provide jcOpId or jobCardId',
    path: ['jcOpId'],
  });
export type ListOpMachineOutputQuery = z.infer<typeof listOpMachineOutputQuerySchema>;

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
  /** Time of this entry (HH:MM). Optional — omitted rows keep the historical
   *  null. Stored in op_log.start_time, which despite its name is simply "the
   *  clock time of this log row": it was only ever populated by the 'start'
   *  marker, so completion rows carried no time at all and the JC completion
   *  feed (job-cards/service.ts:739, which already reads it for every log type)
   *  could only ever show a time against a start. */
  logTime: z.string().regex(/^\d{1,2}:\d{2}(:\d{2})?$/).optional(),
  shift: shiftSchema,
  operatorId: z.string().uuid().optional(),
  operatorName: z.string().min(1).max(120).optional(),
  remarks: z.string().max(500).optional(),
});
export type SubmitOpLogInput = z.infer<typeof submitOpLogInputSchema>;

export const startOpInputSchema = z
  .object({
    jcOpId: z.string().uuid(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    startTime: z.string().regex(/^\d{1,2}:\d{2}(:\d{2})?$/),
    shift: shiftSchema,
    operatorId: z.string().uuid().optional(),
    operatorName: z.string().min(1).max(120).optional(),
    remarks: z.string().max(500).optional(),
  })
  .refine((i) => Boolean(i.operatorId) || Boolean(i.operatorName?.trim()), {
    message: 'operatorId or operatorName is required to start an op (legacy line 5497)',
  });
export type StartOpInput = z.infer<typeof startOpInputSchema>;

// QC inspection submit (T-040d per ADR-025). Mirrors legacy submitQcLog
// handler at HTML L3893-3957. Differs from submitOpLogInputSchema:
//  - qty can be 0 (all-rejected case is valid)
//  - rejectQty can be 0 (all-accepted)
//  - at least one of qty / rejectQty must be > 0 (refine)
//  - target op must be qc-bearing (validated server-side via op_type / qc_required)
export const submitQcLogInputSchema = z
  .object({
    jcOpId: z.string().uuid(),
    qty: z.number().int().nonnegative(),
    rejectQty: z.number().int().nonnegative(),
    logDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    /** Time of this inspection (HH:MM). Optional; see submitOpLogInputSchema. */
    logTime: z.string().regex(/^\d{1,2}:\d{2}(:\d{2})?$/).optional(),
    shift: shiftSchema,
    operatorId: z.string().uuid().optional(),
    operatorName: z.string().min(1).max(120).optional(),
    remarks: z.string().max(500).optional(),
    // TPI (Third Party Inspection) metadata — set when this QC log is a TPI
    // inspection (legacy renderTPI / _tpiSubmit). Persisted on op_log (0037).
    isTpi: z.boolean().optional(),
    tpiInspector: z.string().max(120).optional(),
    tpiOrganization: z.string().max(160).optional(),
    tpiCertNo: z.string().max(80).optional(),
    // QC report attachment (migration 0043) — Supabase Storage path (qc-docs
    // bucket) + original file name for a report attached to this QC/TPI entry.
    // Mirrors legacy _qcdAttachReport / _tpiAttachReport (HTML L4180 / L21492).
    qcReportPath: z.string().nullable().optional(),
    qcReportName: z.string().nullable().optional(),
  })
  .refine((i) => i.qty + i.rejectQty > 0, {
    message: 'Enter accepted qty and/or reject qty (legacy line 3895)',
  });
export type SubmitQcLogInput = z.infer<typeof submitQcLogInputSchema>;

// OSP auto-PR generation (ADR-039). Mirror of legacy _autoGenerateOspPR
// (HTML L13302): when a JC op whose name matches a configured OSP process is
// "started", auto-create a JW_OSP purchase request (+ optional draft PO when
// the process has a vendor with autoPo on). Input is just the target op; all
// other fields are derived server-side from the op, its JC, and the matched
// osp_processes row.
export const generateOspPrInputSchema = z.object({
  jcOpId: z.string().uuid(),
});
export type GenerateOspPrInput = z.infer<typeof generateOspPrInputSchema>;

export const generateOspPrResultSchema = z.object({
  prId: z.string().uuid(),
  prCode: z.string(),
  poId: z.string().uuid().nullable(),
  poCode: z.string().nullable(),
  vendorName: z.string().nullable(),
  autoPoCreated: z.boolean(),
  message: z.string(),
});
export type GenerateOspPrResult = z.infer<typeof generateOspPrResultSchema>;

// ─── Query filters ─────────────────────────────────────────────────────────

export const listJcOpsQuerySchema = z
  .object({
    jobCardId: z.string().uuid().optional(),
    jobCardCode: z.string().min(1).max(64).optional(),
    machineId: z.string().uuid().optional(),
  })
  .refine((q) => Boolean(q.jobCardId || q.jobCardCode || q.machineId), {
    message: 'Provide jobCardId, jobCardCode, or machineId',
  });
export type ListJcOpsQuery = z.infer<typeof listJcOpsQuerySchema>;

export const listOpLogQuerySchema = z
  .object({
    jcOpId: z.string().uuid().optional(),
    /** All op_log rows across a whole JC's ops (status timeline + print log). */
    jobCardId: z.string().uuid().optional(),
    limit: z.coerce.number().int().positive().max(500).default(100),
  })
  .refine((q) => Boolean(q.jcOpId || q.jobCardId), {
    message: 'Provide jcOpId or jobCardId',
    path: ['jcOpId'],
  });
export type ListOpLogQuery = z.infer<typeof listOpLogQuerySchema>;

export const listRunningOpsQuerySchema = z.object({
  status: runningOpStatusSchema.optional(),
});
export type ListRunningOpsQuery = z.infer<typeof listRunningOpsQuerySchema>;
