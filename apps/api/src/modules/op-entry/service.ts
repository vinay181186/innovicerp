// Op Entry service — read jc_ops/op_log/running_ops; write op_log entries
// and running_ops sessions. All status values come from v_jc_op_status (the
// SQL mirror of legacy calcEngine, see ADR-011 #2).
//
// Validations land here per CLAUDE.md §6.2 ("every write goes through a
// service layer"). The two critical checks (cannot exceed planned qty,
// cannot skip required QC) read from v_jc_op_status, NOT from a recomputation:
//   - "qty <= available" uses v_jc_op_status.available
//   - "no submit when qc_pending" uses v_jc_op_status.computed_status
//
// ADR-011 #4 makes op_log immutable. ADR-127 narrows that to the numbers: a
// wrong log_date / start_time can be corrected via updateOpLogTiming, and the
// DB trigger op_log_timing_only_update (0097) refuses the write if any other
// column moved. There is still no way to change a qty and no deleteOpLog.
//
// Running-ops uniqueness is enforced at the DB layer via the partial unique
// indexes on (company_id, jc_op_id) where status='running' and on
// (machine_id) where status='running' and is_osp=false. The service catches
// the resulting unique-violation and returns a typed ConflictError.

import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  approvalConfig,
  jcOps,
  jobCards,
  machines,
  opLog,
  opLogTimeChangeRequests,
  runningOps,
} from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { requireOpEntryRole, requireQcRole, requireWriteRole } from '../../lib/auth';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';
import { autoCreateNcFromQcReject } from '../nc-register/cascades';
import { generateOspPrForOp } from './osp-cascade';
import { tryApplyQcStockCascade } from './qc-stock-cascade';
import { tryCascadeJcComplete } from './sales-cascade';
import type {
  DecideOpLogTimeChangeInput,
  GenerateOspPrInput,
  GenerateOspPrResult,
  JcOpEnriched,
  ListJcOpsQuery,
  ListOpLogQuery,
  ListOpLogTimeChangeRequestsQuery,
  ListOpMachineOutputQuery,
  ListRunningOpsQuery,
  OpLog,
  OpLogChangeStatus,
  OpLogTimeChangeRequest,
  OpMachineOutput,
  RunningOp,
  StartOpInput,
  SubmitOpLogInput,
  SubmitQcLogInput,
  UpdateOpLogTimingInput,
  UpdateOpLogTimingResult,
} from './schema';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

// ─── Reads ────────────────────────────────────────────────────────────────

export async function listJcOpsEnriched(
  input: ListJcOpsQuery,
  user: AuthContext,
): Promise<JcOpEnriched[]> {
  const companyId = requireCompany(user);
  if (!input.jobCardId && !input.jobCardCode && !input.machineId) {
    throw new ValidationError('Provide jobCardId, jobCardCode, or machineId');
  }
  return withUserContext(user, async (tx) => {
    const filter = input.jobCardId
      ? sql`jc.id = ${input.jobCardId}::uuid`
      : input.jobCardCode
        ? sql`jc.code = ${input.jobCardCode}`
        : sql`o.machine_id = ${input.machineId!}::uuid`;
    const orderBy = input.machineId
      ? sql`ORDER BY jc.code ASC, o.op_seq ASC`
      : sql`ORDER BY o.op_seq ASC`;
    const result = await tx.execute(sql`
      SELECT
        o.id,
        o.job_card_id          AS "jobCardId",
        jc.code                AS "jobCardCode",
        COALESCE(so.code, jw.code) AS "soCode",
        o.op_seq               AS "opSeq",
        m.code                 AS "machineCode",
        o.machine_code_text    AS "machineCodeText",
        o.operation,
        o.op_type              AS "opType",
        o.cycle_time_min::text AS "cycleTimeMin",
        o.program,
        o.tool_no              AS "toolNo",
        o.qc_required          AS "qcRequired",
        o.rework_qty           AS "reworkQty",
        o.outsource_status     AS "outsourceStatus",
        s.completed_qty        AS "completedQty",
        s.qc_accepted_qty      AS "qcAcceptedQty",
        s.qc_rejected_qty      AS "qcRejectedQty",
        s.input_avail          AS "inputAvail",
        s.available            AS "available",
        s.at_vendor_qty        AS "atVendorQty",
        s.in_qc_qty            AS "inQcQty",
        s.qc_pending           AS "qcPending",
        s.pending_qty          AS "pendingQty",
        s.rework_pending_qty   AS "reworkPendingQty",
        s.rework_raised_qty    AS "reworkRaisedQty",
        s.rework_raised_to_ops AS "reworkRaisedToOps",
        s.computed_status      AS "computedStatus",
        -- Who actually made the completed qty, per machine (0095 / ADR-126).
        -- The machine columns above are the op's CURRENT machine — where the
        -- REMAINING qty runs — so on a re-routed op they name a machine that
        -- may have produced nothing. This is the honest breakdown.
        COALESCE(mo.machines, '[]'::json) AS "machines"
      FROM public.jc_ops o
      JOIN public.job_cards jc ON jc.id = o.job_card_id
      LEFT JOIN public.sales_order_lines sol ON sol.id = jc.source_so_line_id AND sol.deleted_at IS NULL
      LEFT JOIN public.sales_orders so ON so.id = sol.sales_order_id AND so.deleted_at IS NULL
      LEFT JOIN public.job_work_order_lines jwl ON jwl.id = jc.source_jw_line_id AND jwl.deleted_at IS NULL
      LEFT JOIN public.job_work_orders jw ON jw.id = jwl.job_work_order_id AND jw.deleted_at IS NULL
      LEFT JOIN public.machines m ON m.id = o.machine_id
      LEFT JOIN public.v_jc_op_status s ON s.jc_op_id = o.id
      LEFT JOIN LATERAL (
        SELECT json_agg(
                 json_build_object('machineCode', v.machine_code, 'qty', v.completed_qty)
                 ORDER BY v.completed_qty DESC, v.machine_code
               ) AS machines
        FROM public.v_op_machine_output v
        WHERE v.jc_op_id = o.id
      ) mo ON true
      WHERE o.company_id = ${companyId}::uuid
        AND o.deleted_at IS NULL
        AND ${filter}
      ${orderBy}
    `);
    return (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      ...r,
      reworkQty: Number(r['reworkQty']),
      opSeq: Number(r['opSeq']),
      completedQty: Number(r['completedQty'] ?? 0),
      qcAcceptedQty: Number(r['qcAcceptedQty'] ?? 0),
      qcRejectedQty: Number(r['qcRejectedQty'] ?? 0),
      inputAvail: Number(r['inputAvail'] ?? 0),
      available: Number(r['available'] ?? 0),
      atVendorQty: Number(r['atVendorQty'] ?? 0),
      inQcQty: Number(r['inQcQty'] ?? 0),
      qcPending: Number(r['qcPending'] ?? 0),
      pendingQty: Number(r['pendingQty'] ?? 0),
      reworkPendingQty: Number(r['reworkPendingQty'] ?? 0),
      reworkRaisedQty: Number(r['reworkRaisedQty'] ?? 0),
      reworkRaisedToOps: (r['reworkRaisedToOps'] as string | null) ?? null,
      machines: ((r['machines'] as Array<{ machineCode: string; qty: unknown }> | null) ?? []).map(
        (v) => ({ machineCode: String(v.machineCode), qty: Number(v.qty ?? 0) }),
      ),
    })) as unknown as JcOpEnriched[];
  });
}

export async function listOpLog(input: ListOpLogQuery, user: AuthContext): Promise<OpLog[]> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const scope = input.jobCardId
      ? sql`${opLog.jcOpId} IN (SELECT id FROM public.jc_ops WHERE job_card_id = ${input.jobCardId}::uuid AND deleted_at IS NULL)`
      : sql`${opLog.jcOpId} = ${input.jcOpId!}::uuid`;
    // machines is LEFT JOINed for the LIVE master code (0095); machineCodeText
    // is the snapshot taken when the entry was written and can differ from it.
    const rows = await tx
      .select({
        id: opLog.id,
        jcOpId: opLog.jcOpId,
        logNo: opLog.logNo,
        logType: opLog.logType,
        logDate: opLog.logDate,
        shift: opLog.shift,
        qty: opLog.qty,
        rejectQty: opLog.rejectQty,
        operatorId: opLog.operatorId,
        operatorName: opLog.operatorName,
        machineId: opLog.machineId,
        machineCode: machines.code,
        machineCodeText: opLog.machineCodeText,
        startTime: opLog.startTime,
        remarks: opLog.remarks,
        timingEditedAt: opLog.timingEditedAt,
        createdAt: opLog.createdAt,
        createdBy: opLog.createdBy,
      })
      .from(opLog)
      .leftJoin(machines, eq(machines.id, opLog.machineId))
      .where(and(eq(opLog.companyId, companyId), scope))
      .orderBy(desc(opLog.createdAt))
      .limit(input.limit);
    return rows.map(toOpLog) as OpLog[];
  });
}

type OpLogRow = {
  id: string;
  jcOpId: string;
  logNo: string;
  logType: OpLog['logType'];
  logDate: string;
  shift: OpLog['shift'];
  qty: number;
  rejectQty: number;
  operatorId: string | null;
  operatorName: string | null;
  machineId: string | null;
  machineCode: string | null;
  machineCodeText: string | null;
  startTime: string | null;
  remarks: string | null;
  timingEditedAt: Date | string | null;
  createdAt: Date | string;
  createdBy: string;
};

const asIso = (v: Date | string | null): string | null =>
  v === null ? null : v instanceof Date ? v.toISOString() : String(v);

function toOpLog(r: OpLogRow): OpLog {
  return {
    id: r.id,
    jcOpId: r.jcOpId,
    logNo: r.logNo,
    logType: r.logType,
    logDate: r.logDate,
    shift: r.shift,
    qty: r.qty,
    rejectQty: r.rejectQty,
    operatorId: r.operatorId,
    operatorName: r.operatorName,
    machineId: r.machineId,
    machineCode: r.machineCode,
    machineCodeText: r.machineCodeText,
    startTime: r.startTime,
    remarks: r.remarks,
    timingEditedAt: asIso(r.timingEditedAt),
    createdAt: asIso(r.createdAt)!,
    createdBy: r.createdBy,
  };
}

// Same projection as listOpLog, for one row. Used to return the fresh entry
// after a timing correction so the UI never has to guess what the DB stored.
async function selectOpLogById(
  tx: DbTransaction,
  id: string,
  companyId: string,
): Promise<OpLog | null> {
  const rows = await tx
    .select({
      id: opLog.id,
      jcOpId: opLog.jcOpId,
      logNo: opLog.logNo,
      logType: opLog.logType,
      logDate: opLog.logDate,
      shift: opLog.shift,
      qty: opLog.qty,
      rejectQty: opLog.rejectQty,
      operatorId: opLog.operatorId,
      operatorName: opLog.operatorName,
      machineId: opLog.machineId,
      machineCode: machines.code,
      machineCodeText: opLog.machineCodeText,
      startTime: opLog.startTime,
      remarks: opLog.remarks,
      timingEditedAt: opLog.timingEditedAt,
      createdAt: opLog.createdAt,
      createdBy: opLog.createdBy,
    })
    .from(opLog)
    .leftJoin(machines, eq(machines.id, opLog.machineId))
    .where(and(eq(opLog.id, id), eq(opLog.companyId, companyId)))
    .limit(1);
  const row = rows[0];
  return row ? toOpLog(row) : null;
}

// Machine-wise output (0095). THE answer to "qty wise machine used": one row
// per (operation × machine), read straight off v_op_machine_output so the JC
// screen and the Machine Output report can never disagree. The view already
// filters to log_type='complete' with qty > 0, so 'start' markers and QC
// inspections never inflate the numbers.
export async function listOpMachineOutput(
  input: ListOpMachineOutputQuery,
  user: AuthContext,
): Promise<OpMachineOutput[]> {
  const companyId = requireCompany(user);
  if (!input.jcOpId && !input.jobCardId) {
    throw new ValidationError('Provide jcOpId or jobCardId');
  }
  return withUserContext(user, async (tx) => {
    const result = await tx.execute(sql`
      SELECT
        jc_op_id             AS "jcOpId",
        job_card_id          AS "jobCardId",
        op_seq               AS "opSeq",
        machine_id           AS "machineId",
        machine_code         AS "machineCode",
        machine_name         AS "machineName",
        completed_qty        AS "completedQty",
        reject_qty           AS "rejectQty",
        entry_count          AS "entryCount",
        first_log_date::text AS "firstLogDate",
        last_log_date::text  AS "lastLogDate"
      FROM public.v_op_machine_output
      WHERE company_id = ${companyId}::uuid
        ${input.jcOpId ? sql`AND jc_op_id = ${input.jcOpId}::uuid` : sql``}
        ${input.jobCardId ? sql`AND job_card_id = ${input.jobCardId}::uuid` : sql``}
      ORDER BY op_seq ASC, machine_code ASC
    `);
    return (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      ...r,
      opSeq: Number(r['opSeq']),
      completedQty: Number(r['completedQty'] ?? 0),
      rejectQty: Number(r['rejectQty'] ?? 0),
      entryCount: Number(r['entryCount'] ?? 0),
    })) as unknown as OpMachineOutput[];
  });
}

export async function listRunningOps(
  input: ListRunningOpsQuery,
  user: AuthContext,
): Promise<RunningOp[]> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const result = await tx.execute(sql`
      SELECT
        r.id,
        r.jc_op_id          AS "jcOpId",
        jc.code             AS "jobCardCode",
        o.op_seq            AS "opSeq",
        o.operation,
        r.machine_id        AS "machineId",
        m.code              AS "machineCode",
        r.is_osp            AS "isOsp",
        r.operator_id       AS "operatorId",
        r.operator_name     AS "operatorName",
        r.start_date        AS "startDate",
        r.start_time::text  AS "startTime",
        r.shift,
        r.status,
        r.ended_at          AS "endedAt"
      FROM public.running_ops r
      JOIN public.jc_ops o    ON o.id = r.jc_op_id
      JOIN public.job_cards jc ON jc.id = o.job_card_id
      LEFT JOIN public.machines m ON m.id = r.machine_id
      WHERE r.company_id = ${companyId}::uuid
        ${input.status ? sql`AND r.status = ${input.status}::running_op_status` : sql``}
      ORDER BY r.start_date DESC, r.start_time DESC
      LIMIT 200
    `);
    return (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      ...r,
      opSeq: Number(r['opSeq']),
      startDate:
        r['startDate'] instanceof Date
          ? (r['startDate'] as Date).toISOString().slice(0, 10)
          : String(r['startDate']),
      endedAt:
        r['endedAt'] instanceof Date
          ? (r['endedAt'] as Date).toISOString()
          : (r['endedAt'] as string | null),
    })) as unknown as RunningOp[];
  });
}

// ─── Writes ────────────────────────────────────────────────────────────────

interface JcOpRow {
  id: string;
  jobCardId: string;
  opSeq: number;
  opType: 'process' | 'qc' | 'outsource';
  machineId: string | null;
  machineCodeText: string | null;
}

interface AvailabilitySnapshot {
  available: number;
  computedStatus: string;
}

async function loadJcOp(
  tx: Parameters<Parameters<typeof withUserContext<unknown>>[1]>[0],
  jcOpId: string,
  companyId: string,
): Promise<JcOpRow> {
  const rows = await tx
    .select({
      id: jcOps.id,
      jobCardId: jcOps.jobCardId,
      opSeq: jcOps.opSeq,
      opType: jcOps.opType,
      machineId: jcOps.machineId,
      machineCodeText: jcOps.machineCodeText,
    })
    .from(jcOps)
    .where(and(eq(jcOps.id, jcOpId), eq(jcOps.companyId, companyId)))
    .limit(1);
  const op = rows[0];
  if (!op) throw new NotFoundError(`Op ${jcOpId} not found`);
  return op as JcOpRow;
}

// ─── Machine stamping (0095) ───────────────────────────────────────────────
//
// An op_log row records the machine that made ITS pieces, so changing the
// operation's machine mid-way never re-attributes past production.
//
// Resolution order:
//   1. The OPEN non-OSP running session on this op — that is the machine
//      physically doing the work right now, and it is what the operator sees
//      on the Live Ops board. It wins even when the op's own machine_id was
//      since edited.
//   2. The op's own machine_id (no session, e.g. a straight log without start).
//   3. Text only: jc_ops.machine_code_text, for plan/route-sourced ops that
//      never resolved an FK (ADR-012 #10). Never the literal 'QC' — that is a
//      type label written by the route builder, not a machine (ISSUE-010).
interface StampedMachine {
  machineId: string | null;
  /** Live machines-master code for machineId; null when nothing resolved. */
  machineCode: string | null;
  /** Snapshot written to op_log.machine_code_text. */
  machineCodeText: string | null;
}

async function resolveLogMachine(
  tx: Parameters<Parameters<typeof withUserContext<unknown>>[1]>[0],
  op: JcOpRow,
  companyId: string,
): Promise<StampedMachine> {
  const sessions = await tx
    .select({ machineId: runningOps.machineId })
    .from(runningOps)
    .where(
      and(
        eq(runningOps.jcOpId, op.id),
        eq(runningOps.companyId, companyId),
        eq(runningOps.status, 'running'),
        eq(runningOps.isOsp, false),
      ),
    )
    .limit(1);
  const machineId = sessions[0]?.machineId ?? op.machineId ?? null;
  const textFallback =
    op.machineCodeText && op.machineCodeText !== 'QC' ? op.machineCodeText : null;

  if (machineId) {
    const m = await tx
      .select({ code: machines.code })
      .from(machines)
      .where(eq(machines.id, machineId))
      .limit(1);
    const code = m[0]?.code ?? null;
    return { machineId, machineCode: code, machineCodeText: code ?? textFallback };
  }

  return { machineId: null, machineCode: null, machineCodeText: textFallback };
}

async function loadAvailability(
  tx: Parameters<Parameters<typeof withUserContext<unknown>>[1]>[0],
  jcOpId: string,
): Promise<AvailabilitySnapshot> {
  const rows = await tx.execute(sql`
    SELECT available, computed_status AS "computedStatus"
    FROM public.v_jc_op_status WHERE jc_op_id = ${jcOpId}::uuid
  `);
  const snapshot = (rows as unknown as Array<{ available: number; computedStatus: string }>)[0];
  return {
    available: snapshot ? Number(snapshot.available) : 0,
    computedStatus: snapshot ? snapshot.computedStatus : 'waiting',
  };
}

// ─── Client-material gate (JWSO job-work) ───────────────────────────────────
//
// In job-work, the CLIENT supplies the raw material, received via a Party
// Material GRN. The shop must only be able to work the quantity of material
// that has actually arrived for that part — e.g. order 50, material 30 → only
// 30 can be started/logged; when the remaining 20 arrives the limit lifts on
// its own (it is recomputed on every start/log).
//
// Scope: applies ONLY to the FIRST operation of a JWSO-sourced Job Card. Later
// operations need no material check — they are already capped by the previous
// op's output (v_jc_op_status input_avail = prior op output). SO-sourced /
// direct-production Job Cards (source_jw_line_id IS NULL) are never capped.
// Returns null when no cap applies.
export interface MaterialCap {
  /** Qty the cap is measured against: ISSUED for gated JCs (ADR-103), RECEIVED
   *  for pre-cutover ones that keep the old ADR-096/097 behaviour. */
  received: number;
  orderQty: number;
  shortfall: number;
  jwCode: string;
  /** True when the figure above is issued-to-this-JC (ADR-103), so the error
   *  message can name the right document to go and create. */
  issuedBased: boolean;
}

export async function loadMaterialCap(
  tx: DbTransaction,
  op: { jobCardId: string; opSeq: number },
  companyId: string,
): Promise<MaterialCap | null> {
  // Only the first (lowest op_seq) non-deleted op of the JC carries the cap.
  const firstRows = (await tx.execute(sql`
    SELECT MIN(op_seq) AS "minSeq"
    FROM public.jc_ops
    WHERE job_card_id = ${op.jobCardId}::uuid AND deleted_at IS NULL
  `)) as unknown as Array<{ minSeq: number | null }>;
  const minSeq = firstRows[0]?.minSeq;
  if (minSeq == null || op.opSeq !== Number(minSeq)) return null;

  // The JC must be JWSO-sourced; resolve its JW line + order qty + line count.
  const jcRows = (await tx.execute(sql`
    SELECT jc.order_qty        AS "orderQty",
           jwl.line_no         AS "lineNo",
           jwl.job_work_order_id AS "jwoId",
           jwo.code            AS "jwCode",
           jc.client_material_gate AS "gated",
           (SELECT COUNT(*) FROM public.job_work_order_lines l
              WHERE l.job_work_order_id = jwl.job_work_order_id
                AND l.deleted_at IS NULL) AS "lineCount"
    FROM public.job_cards jc
    JOIN public.job_work_order_lines jwl
      ON jwl.id = jc.source_jw_line_id AND jwl.deleted_at IS NULL
    JOIN public.job_work_orders jwo ON jwo.id = jwl.job_work_order_id
    WHERE jc.id = ${op.jobCardId}::uuid
      AND jc.company_id = ${companyId}::uuid
      AND jc.deleted_at IS NULL
    LIMIT 1
  `)) as unknown as Array<{
    orderQty: number;
    lineNo: number;
    jwoId: string;
    jwCode: string;
    gated: boolean;
    lineCount: number;
  }>;
  const jc = jcRows[0];
  if (!jc) return null; // SO-sourced / no JW line → no client material to gate on.

  const orderQty = Number(jc.orderQty);
  const lineCount = Number(jc.lineCount);

  // ADR-103: gated Job Cards measure against material ISSUED to THIS job card.
  // Receiving material is no longer enough — it must be handed to the job.
  // Job Cards created before the cutover keep the ADR-096/097 received-based
  // behaviour so live work is never frozen retroactively.
  if (jc.gated) {
    const issRows = (await tx.execute(sql`
      SELECT COALESCE(SUM(qty), 0)::int AS "issued"
      FROM public.party_material_issues
      WHERE job_card_id = ${op.jobCardId}::uuid AND deleted_at IS NULL
    `)) as unknown as Array<{ issued: number }>;
    const issued = Number(issRows[0]?.issued ?? 0);
    return {
      received: issued,
      orderQty,
      shortfall: Math.max(0, orderQty - issued),
      jwCode: jc.jwCode,
      issuedBased: true,
    };
  }
  // Material received for THIS part. Single-line JWSO → every receipt for the
  // order belongs to the one line (robust even if the line-no text is blank).
  // Multi-line JWSO → match on the recorded JW line number so one part's
  // material never covers another part.
  const lineFilter =
    lineCount > 1 ? sql`AND pgl.jw_line_no_text = ${String(jc.lineNo)}` : sql``;
  const recRows = (await tx.execute(sql`
    SELECT COALESCE(SUM(pgl.received_qty), 0)::int AS "received"
    FROM public.party_grn pg
    JOIN public.party_grn_lines pgl
      ON pgl.party_grn_id = pg.id AND pgl.deleted_at IS NULL
    WHERE pg.company_id = ${companyId}::uuid
      AND pg.deleted_at IS NULL
      AND pg.job_work_order_id = ${jc.jwoId}::uuid
      ${lineFilter}
  `)) as unknown as Array<{ received: number }>;
  const received = Number(recRows[0]?.received ?? 0);
  const shortfall = Math.max(0, orderQty - received);
  return { received, orderQty, shortfall, jwCode: jc.jwCode, issuedBased: false };
}

/** Plain-language refusal naming the document the user must go and create.
 *
 *  Exported because the OSP outward-DC gate (delivery-challans/cascades.ts)
 *  shares `loadMaterialCap` and must not tell the user to "record a Party
 *  Material GRN" when the real blocker is the missing ISSUE (ADR-103). */
export function materialCapMessage(cap: MaterialCap, allowed: number, asked: number): string {
  if (!cap.issuedBased) {
    return (
      `Qty ${asked} exceeds client material received. Only ${allowed} can be worked now ` +
      `(received ${cap.received} of ${cap.orderQty} for this part, JWSO ${cap.jwCode}). ` +
      `Record a Party Material GRN for the balance to continue.`
    );
  }
  if (allowed <= 0) {
    return cap.received === 0
      ? `No client material has been issued to this job card yet, so work cannot start. ` +
          `Issue material from Party Material Issue first (JWSO ${cap.jwCode}).`
      : `All ${cap.received} issued piece(s) are already accounted for on this job card. ` +
          `Issue more client material to continue (JWSO ${cap.jwCode}).`;
  }
  return (
    `Qty ${asked} is more than the client material issued to this job card. ` +
    `Only ${allowed} can be worked now (${cap.received} of ${cap.orderQty} issued, ` +
    `JWSO ${cap.jwCode}). Issue more material from Party Material Issue to continue.`
  );
}

function nextLogNo(): string {
  // Simple monotonic-ish marker; not unique by spec (ADR-011 #4 acknowledges
  // legacy log_no duplicates). UUID PK is the addressable id.
  const now = new Date();
  const stamp = now
    .toISOString()
    .replace(/[-:T.Z]/g, '')
    .slice(0, 14);
  return `LOG-${stamp}`;
}

export async function submitOpLog(input: SubmitOpLogInput, user: AuthContext): Promise<OpLog> {
  requireOpEntryRole(user);
  // Per-department tier gate (op_entry sits in Production). The role guard alone
  // let anyone with a write-ish role log production; the matrix narrows it to a
  // user granted `entry` on Op Entry. Admins bypass.
  await requireFormAccess(user, 'op_entry', 'entry');
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const op = await loadJcOp(tx, input.jcOpId, companyId);
    if (op.opType === 'outsource') {
      throw new ValidationError(
        'This is an outsource operation; use the procurement flow, not Op Entry',
      );
    }
    // T-040d / ISSUE-001 — production-complete logs are not valid against QC ops.
    // QC ops use POST /op-entry/qc-log which writes log_type='qc' with split
    // accept/reject qty.
    if (op.opType === 'qc') {
      throw new ValidationError(
        'This is a QC operation; use the QC inspection flow (POST /op-entry/qc-log)',
      );
    }

    // Serialize concurrent production logs on the SAME op: lock the jc_ops row
    // so two operators can't both read the same `available` and both insert,
    // over-producing past the planned qty.
    await tx.execute(sql`SELECT 1 FROM public.jc_ops WHERE id = ${input.jcOpId}::uuid FOR UPDATE`);

    const snapshot = await loadAvailability(tx, input.jcOpId);
    if (snapshot.computedStatus === 'qc_pending') {
      throw new ValidationError('Operation is waiting for QC clearance — go to QC dashboard');
    }
    // Client-material gate: on the first op of a JWSO Job Card, cap the loggable
    // qty at the client material available for this part — ISSUED to this job
    // card (ADR-103), or RECEIVED for the part on pre-cutover job cards
    // (ADR-096/097).
    const cap = await loadMaterialCap(tx, op, companyId);
    const effectiveAvailable = cap
      ? Math.max(0, snapshot.available - cap.shortfall)
      : snapshot.available;
    if (input.qty > effectiveAvailable) {
      if (cap && effectiveAvailable < snapshot.available) {
        throw new ValidationError(materialCapMessage(cap, effectiveAvailable, input.qty));
      }
      throw new ValidationError(
        `Qty ${input.qty} exceeds available ${snapshot.available} — cannot exceed planned qty`,
      );
    }

    // 0095 — stamp the machine that made THIS qty (open session first, then the
    // op's own machine), so a later machine change rewrites no history.
    const stamped = await resolveLogMachine(tx, op, companyId);

    const inserted = await tx
      .insert(opLog)
      .values({
        companyId,
        jcOpId: input.jcOpId,
        logNo: nextLogNo(),
        logType: 'complete',
        logDate: input.logDate,
        shift: input.shift,
        qty: input.qty,
        rejectQty: input.rejectQty ?? 0,
        operatorId: input.operatorId ?? null,
        operatorName: input.operatorName ?? null,
        machineId: stamped.machineId,
        machineCodeText: stamped.machineCodeText,
        // The clock time of this completion, when the operator supplied one.
        // Was hard-coded null, so a completion log carried no time at all and
        // the JC completion feed (which already reads start_time for every log
        // type) could only ever show a time against a 'start' marker.
        startTime: input.logTime ?? null,
        remarks: input.remarks ?? null,
        createdBy: user.id,
      })
      .returning();

    // After this insert, recompute availability — if we've consumed all
    // available qty for this op, transition any active running_op to 'done'
    // AND auto-set qcCallDate on the next QC op (mirrors legacy line 5471-5479).
    const post = await loadAvailability(tx, input.jcOpId);
    if (post.available === 0) {
      await tx
        .update(runningOps)
        .set({ status: 'done', endedAt: new Date(), updatedBy: user.id })
        .where(
          and(
            eq(runningOps.jcOpId, input.jcOpId),
            eq(runningOps.companyId, companyId),
            eq(runningOps.status, 'running'),
          ),
        );

      // Look up the next op in the same JC; if it's a QC op without a
      // qc_call_date, set it to today's log_date. Operators rely on this to
      // know which QC ops are now ready to inspect.
      const next = await tx
        .select({
          id: jcOps.id,
          opType: jcOps.opType,
          qcRequired: jcOps.qcRequired,
          qcCallDate: jcOps.qcCallDate,
        })
        .from(jcOps)
        .where(and(eq(jcOps.jobCardId, op.jobCardId), eq(jcOps.opSeq, op.opSeq + 1)))
        .limit(1);
      const nextOp = next[0];
      if (nextOp && (nextOp.opType === 'qc' || nextOp.qcRequired) && !nextOp.qcCallDate) {
        await tx
          .update(jcOps)
          .set({ qcCallDate: input.logDate, updatedBy: user.id })
          .where(eq(jcOps.id, nextOp.id));
      }

      // T-033: cascade SO/JW line + header auto-close when this insert
      // brings the JC to v_jc_status.computed_status='complete'. Idempotent;
      // no-op for source-less JCs or already-closed lines.
      await tryCascadeJcComplete(tx, op.jobCardId, user);
    }

    const row = inserted[0]!;

    // Audit: emit OP_COMPLETE keyed by JC code (legacy line 5459).
    const jcMeta = await tx
      .select({ code: jobCards.code, operation: jcOps.operation })
      .from(jcOps)
      .innerJoin(jobCards, eq(jobCards.id, jcOps.jobCardId))
      .where(eq(jcOps.id, input.jcOpId))
      .limit(1);
    const meta = jcMeta[0];
    if (meta) {
      const operatorPart = input.operatorName ? ` by ${input.operatorName}` : '';
      await emitActivityLog(
        tx,
        {
          action: 'OP_COMPLETE',
          entity: 'Op',
          detail: `${meta.code} Op #${op.opSeq} — ${input.qty} pcs${operatorPart}`,
          refId: meta.code,
        },
        companyId,
        user,
      );
    }

    return {
      id: row.id,
      jcOpId: row.jcOpId,
      logNo: row.logNo,
      logType: row.logType,
      logDate: row.logDate,
      shift: row.shift,
      qty: row.qty,
      rejectQty: row.rejectQty,
      operatorId: row.operatorId,
      operatorName: row.operatorName,
      machineId: row.machineId,
      machineCode: stamped.machineCode,
      machineCodeText: row.machineCodeText,
      startTime: row.startTime,
      remarks: row.remarks,
      timingEditedAt: null, // just inserted
      createdAt:
        row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
      createdBy: row.createdBy,
    } as OpLog;
  });
}

// QC inspection submit (T-040d per ADR-025). Mirrors legacy submitQcLog
// at HTML L3893-3957. Writes log_type='qc' with qty (accepted) + reject_qty
// against a qc-bearing op (op_type='qc' OR qc_required=true).
//
// Side effects (same tx):
//   - jc_ops.qc_attended_date = log_date
//   - jc_ops.qc_call_date backfilled if null (most recent prior op's complete
//     log date, fallback to log_date itself; mirrors legacy L3909-3913)
//   - tryCascadeJcComplete after the insert (closes SO/JW line + header if
//     this QC log brings the JC to v_jc_status.computed_status='complete')
//   - emitActivityLog action='OP_QC' keyed by JC code
//
// NOT done in this slice (deferred follow-ons per ADR-025):
//   - T-040e: auto-create NC on rejectQty > 0
//   - T-040f: last-op stock cascade (items.stock_qty + store_transactions)
//   - QC report file attachment (deferred per ADR-022 — qcDocUploads doc_missing)
export async function submitQcLog(input: SubmitQcLogInput, user: AuthContext): Promise<OpLog> {
  requireOpEntryRole(user);
  // ADR-035: the role guard alone let a manager record QC even when their QC
  // department tier is L1 (view-only). Enforce the per-department QC tier too —
  // a user must have `entry` on the QC Call Register form to accept/reject qty.
  // Admins bypass; the matrix can only narrow what the role already allows.
  await requireFormAccess(user, 'qc_submit', 'entry');
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    // Load op + qc_required + qc_call_date in one go (loadJcOp doesn't carry
    // qcRequired or qcCallDate; rather than bloat its signature, query inline).
    const opRows = await tx
      .select({
        id: jcOps.id,
        jobCardId: jcOps.jobCardId,
        opSeq: jcOps.opSeq,
        opType: jcOps.opType,
        qcRequired: jcOps.qcRequired,
        qcCallDate: jcOps.qcCallDate,
        operation: jcOps.operation,
      })
      .from(jcOps)
      .where(and(eq(jcOps.id, input.jcOpId), eq(jcOps.companyId, companyId)))
      .limit(1);
    const op = opRows[0];
    if (!op) throw new NotFoundError(`Op ${input.jcOpId} not found`);

    const isQcBearing = op.opType === 'qc' || op.qcRequired;
    if (!isQcBearing) {
      throw new ValidationError(
        'This operation does not require QC; use POST /op-entry/op-log for production logs',
      );
    }

    // Serialize concurrent QC logs on the SAME op (over-inspection race).
    await tx.execute(sql`SELECT 1 FROM public.jc_ops WHERE id = ${input.jcOpId}::uuid FOR UPDATE`);

    // qc_pending lives in v_jc_op_status — same view that drives the UI.
    const pendingRows = await tx.execute(sql`
      SELECT qc_pending FROM public.v_jc_op_status WHERE jc_op_id = ${input.jcOpId}::uuid
    `);
    const qcPending = Number(
      (pendingRows as unknown as Array<{ qc_pending: number }>)[0]?.qc_pending ?? 0,
    );
    const total = input.qty + input.rejectQty;
    if (qcPending <= 0) {
      throw new ValidationError('No QC pending on this operation');
    }
    // ADR-103: NO client-material gate on QC. Client-supplied material never
    // goes through inspection — a Party GRN is followed straight by an issue,
    // and Incoming QC has no connection to party_grn at all. The gate belongs
    // on production (submitOpLog / startOp), which is already capped at the
    // issued qty; QC here only ever sees what production already produced, so
    // capping it again would double-count the same restriction.
    if (total > qcPending) {
      throw new ValidationError(
        `Total qty ${total} exceeds QC pending ${qcPending} — cannot inspect more than what's pending`,
      );
    }

    // Backfill qc_call_date if null. Legacy L3909-3913: most recent prior op's
    // complete log date, fallback to today's log_date.
    let resolvedCallDate: string = op.qcCallDate ?? input.logDate;
    if (!op.qcCallDate) {
      const priorRows = await tx.execute(sql`
        SELECT l.log_date::text AS log_date
        FROM public.op_log l
        JOIN public.jc_ops o ON o.id = l.jc_op_id
        WHERE o.job_card_id = ${op.jobCardId}::uuid
          AND o.op_seq < ${op.opSeq}
          AND l.log_type = 'complete'
        ORDER BY l.log_date DESC
        LIMIT 1
      `);
      const priorDate = (priorRows as unknown as Array<{ log_date: string }>)[0]?.log_date;
      if (priorDate) resolvedCallDate = priorDate;
    }

    // Update jc_ops dates. Skip the call-date column when it was already set
    // so we don't churn updated_at on every QC log.
    if (op.qcCallDate) {
      await tx
        .update(jcOps)
        .set({ qcAttendedDate: input.logDate, updatedBy: user.id })
        .where(eq(jcOps.id, input.jcOpId));
    } else {
      await tx
        .update(jcOps)
        .set({
          qcCallDate: resolvedCallDate,
          qcAttendedDate: input.logDate,
          updatedBy: user.id,
        })
        .where(eq(jcOps.id, input.jcOpId));
    }

    // Insert the QC log.
    const inserted = await tx
      .insert(opLog)
      .values({
        companyId,
        jcOpId: input.jcOpId,
        logNo: nextLogNo(),
        logType: 'qc',
        logDate: input.logDate,
        shift: input.shift,
        qty: input.qty,
        rejectQty: input.rejectQty,
        operatorId: input.operatorId ?? null,
        operatorName: input.operatorName ?? null,
        // 0095 — no machine on QC: inspection is not machining, and jc_ops
        // carries the literal 'QC' as a type label, not a machine (ISSUE-010).
        // Time of the inspection, when supplied (was hard-coded null).
        startTime: input.logTime ?? null,
        remarks: input.remarks ?? null,
        isTpi: input.isTpi ?? false,
        tpiInspector: input.tpiInspector ?? null,
        tpiOrganization: input.tpiOrganization ?? null,
        tpiCertNo: input.tpiCertNo ?? null,
        // QC report attachment (migration 0043) — persist the storage path +
        // original file name when the inspector attached a report.
        qcReportPath: input.qcReportPath ?? null,
        qcReportName: input.qcReportName ?? null,
        createdBy: user.id,
      })
      .returning();
    const row = inserted[0]!;

    // Look up JC code once — used for cascade audit, OP_QC audit detail, and
    // the auto-NC code prefix (T-040e).
    const jcMeta = await tx
      .select({ code: jobCards.code })
      .from(jobCards)
      .where(eq(jobCards.id, op.jobCardId))
      .limit(1);
    const jcCode = jcMeta[0]?.code;

    // T-040e: auto-create NC when this QC log rejects qty > 0. Mirrors legacy
    // _autoCreateNC at HTML L3946. Same tx — rollback unwinds both.
    if (input.rejectQty > 0 && jcCode) {
      await autoCreateNcFromQcReject(
        tx,
        {
          companyId,
          jobCardId: op.jobCardId,
          jcOpId: input.jcOpId,
          jcCode,
          opSeq: op.opSeq,
          operationText: op.operation,
          rejectedQty: input.rejectQty,
          ncDate: input.logDate,
          reportedByText: input.operatorName ?? null,
          remarks: input.remarks ?? null,
        },
        user,
      );
    }

    // T-040f: stock cascade — if this QC log is against the LAST op of the
    // JC AND qty (accepted) > 0, write a store_transactions IN row crediting
    // the JC's item. Mirrors legacy stock-add at HTML L3923-3940. No-op when
    // the op isn't the last or accepted qty is 0.
    if (input.qty > 0 && jcCode) {
      await tryApplyQcStockCascade(
        tx,
        {
          companyId,
          jobCardId: op.jobCardId,
          jcCode,
          opSeq: op.opSeq,
          acceptedQty: input.qty,
          txnDate: input.logDate,
        },
        user,
      );
    }

    // Cascade: if this QC log brings the JC to complete (last QC op resolved),
    // close the source SO/JW line + header. Idempotent; no-op for source-less
    // JCs or already-closed lines.
    await tryCascadeJcComplete(tx, op.jobCardId, user);

    // Audit emit. Single OP_QC action with both qtys in detail (one log can
    // carry both per legacy; splitting into _ACCEPT/_REJECT loses the link).
    if (jcCode) {
      const operatorPart = input.operatorName ? ` by ${input.operatorName}` : '';
      await emitActivityLog(
        tx,
        {
          action: 'OP_QC',
          entity: 'Op',
          detail: `${jcCode} Op #${op.opSeq} — ${input.qty} accepted, ${input.rejectQty} rejected${operatorPart}`,
          refId: jcCode,
        },
        companyId,
        user,
      );
    }

    return {
      id: row.id,
      jcOpId: row.jcOpId,
      logNo: row.logNo,
      logType: row.logType,
      logDate: row.logDate,
      shift: row.shift,
      qty: row.qty,
      rejectQty: row.rejectQty,
      operatorId: row.operatorId,
      operatorName: row.operatorName,
      // Always null on QC entries — see the insert above.
      machineId: row.machineId,
      machineCode: null,
      machineCodeText: row.machineCodeText,
      startTime: row.startTime,
      remarks: row.remarks,
      timingEditedAt: null, // just inserted
      createdAt:
        row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
      createdBy: row.createdBy,
    } as OpLog;
  });
}

// Correct WHEN an entry happened. Never WHAT it recorded (ADR-127, 0097).
//
// op_log stays append-only in every sense that matters: qty, reject_qty,
// log_type, machine and operator are untouchable, so v_op_machine_output,
// v_jc_op_status and the Daily Report cannot be moved by an edit. Only the two
// timestamp columns open, and the DB trigger op_log_timing_only_update — not
// this function — is what guarantees that. Before 0097 a mistyped date was
// uncorrectable by any route: there was no UPDATE policy, and the reversing
// entry ADR-011 #4 points to is itself blocked by check op_log_qty_nonneg.
//
// A 'start' marker also owns the open running session's clock, so the session
// is moved with it — otherwise the Live Operations board would keep showing the
// wrong start time after the marker was corrected.
// ADR-130 puts a queue in front of this: an operator's edit becomes a request
// and NOTHING moves until a manager approves. Approving calls straight back
// into applyTimingChange below, so the write itself is identical either way.

type TimingTargetRow = {
  id: string;
  jcOpId: string;
  logNo: string;
  logType: OpLog['logType'];
  logDate: string;
  startTime: string | null;
  qty: number;
};

async function loadTimingTarget(
  tx: DbTransaction,
  opLogId: string,
  companyId: string,
): Promise<TimingTargetRow> {
  const rows = await tx
    .select({
      id: opLog.id,
      jcOpId: opLog.jcOpId,
      logNo: opLog.logNo,
      logType: opLog.logType,
      logDate: opLog.logDate,
      startTime: opLog.startTime,
      qty: opLog.qty,
    })
    .from(opLog)
    .where(and(eq(opLog.id, opLogId), eq(opLog.companyId, companyId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Op log entry not found');
  return row;
}

// The actual write. Only ever reached by someone entitled to make the change
// stick: a manager/admin editing directly, an approver accepting a request, or
// anyone when the approval flag is off.
async function applyTimingChange(
  tx: DbTransaction,
  row: TimingTargetRow,
  nextDate: string,
  nextTime: string | null,
  companyId: string,
  user: AuthContext,
  via: string,
): Promise<OpLog> {
  await tx
    .update(opLog)
    .set({ logDate: nextDate, startTime: nextTime, timingEditedBy: user.id })
    .where(and(eq(opLog.id, row.id), eq(opLog.companyId, companyId)));

  // Keep the live session's clock in step with the marker that opened it.
  if (row.logType === 'start') {
    await tx
      .update(runningOps)
      .set({
        startDate: nextDate,
        ...(nextTime ? { startTime: nextTime } : {}),
        updatedBy: user.id,
      })
      .where(
        and(
          eq(runningOps.companyId, companyId),
          eq(runningOps.jcOpId, row.jcOpId),
          eq(runningOps.status, 'running'),
        ),
      );
  }

  const meta = await tx
    .select({ code: jobCards.code, opSeq: jcOps.opSeq })
    .from(jcOps)
    .innerJoin(jobCards, eq(jobCards.id, jcOps.jobCardId))
    .where(eq(jcOps.id, row.jcOpId))
    .limit(1);
  const jc = meta[0];
  const was = `${row.logDate}${row.startTime ? ` ${row.startTime.slice(0, 5)}` : ''}`;
  const now = `${nextDate}${nextTime ? ` ${nextTime.slice(0, 5)}` : ''}`;
  await emitActivityLog(
    tx,
    {
      action: 'OP_LOG_TIME_EDIT',
      entity: 'Op',
      detail:
        `${jc?.code ?? ''} Op #${jc?.opSeq ?? ''} — ${row.logType} entry ${row.logNo} ` +
        `retimed ${was} → ${now} (qty ${row.qty} unchanged)${via}`,
      refId: jc?.code ?? row.logNo,
    },
    companyId,
    user,
  );

  const updated = await selectOpLogById(tx, row.id, companyId);
  if (!updated) throw new NotFoundError('Op log entry not found');
  return updated;
}

/** Is the op-entry edit approval gate switched on for this company? Reads the
 *  single approval_config row; a company with no row yet takes the schema
 *  default (on), matching APPROVAL_CONFIG_DEFAULTS. */
async function isEditApprovalOn(tx: DbTransaction, companyId: string): Promise<boolean> {
  const rows = await tx
    .select({ flag: approvalConfig.opEntryEditApproval })
    .from(approvalConfig)
    .where(and(eq(approvalConfig.companyId, companyId), isNull(approvalConfig.deletedAt)))
    .limit(1);
  return rows[0]?.flag ?? true;
}

export async function updateOpLogTiming(
  input: UpdateOpLogTimingInput,
  user: AuthContext,
): Promise<UpdateOpLogTimingResult> {
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const row = await loadTimingTarget(tx, input.id, companyId);

    // Who may correct an entry = who may record that kind of entry (the same
    // split the three RLS insert policies make): QC rows are QC's, production
    // rows are the operator's, manager/admin can do either.
    if (row.logType === 'qc') requireQcRole(user);
    else requireOpEntryRole(user);

    const nextTime =
      input.logTime === undefined ? row.startTime : input.logTime === null ? null : input.logTime;
    if (input.logDate === row.logDate && nextTime === row.startTime) {
      const unchanged = await selectOpLogById(tx, input.id, companyId);
      return { applied: true, opLog: unchanged!, request: null };
    }

    // A manager/admin is the approver, so their own edit applies immediately —
    // asking them to approve themselves is a round trip with no reviewer. The
    // gate being off makes any role's edit apply immediately too.
    const isApprover = user.role === 'admin' || user.role === 'manager';
    if (isApprover || !(await isEditApprovalOn(tx, companyId))) {
      const updated = await applyTimingChange(
        tx,
        row,
        input.logDate,
        nextTime,
        companyId,
        user,
        '',
      );
      // ADR-130 (Option B): a direct edit skips the queue, but we still record
      // it as an already-approved change so Approvals → Approved holds EVERY
      // time correction — not only the operator requests that had to wait.
      // decided_by = the editor: an approver approving their own change, or an
      // auto-apply when the gate is off. The partial unique index guards only
      // 'pending' rows, so an approved row never conflicts.
      await tx.insert(opLogTimeChangeRequests).values({
        companyId,
        opLogId: row.id,
        jcOpId: row.jcOpId,
        prevLogDate: row.logDate,
        prevStartTime: row.startTime,
        requestedLogDate: input.logDate,
        requestedStartTime: nextTime,
        reason: input.reason?.trim() || null,
        status: 'approved',
        requestedBy: user.id,
        decidedBy: user.id,
        decidedAt: new Date(),
        createdBy: user.id,
        updatedBy: user.id,
      });
      return { applied: true, opLog: updated, request: null };
    }

    // Gate is on and the requester cannot approve: queue it. The op_log row is
    // deliberately not touched — the entry, the JC feed and every report keep
    // reading the ORIGINAL values until a manager decides.
    let requestId: string;
    try {
      const inserted = await tx
        .insert(opLogTimeChangeRequests)
        .values({
          companyId,
          opLogId: row.id,
          jcOpId: row.jcOpId,
          prevLogDate: row.logDate,
          prevStartTime: row.startTime,
          requestedLogDate: input.logDate,
          requestedStartTime: nextTime,
          reason: input.reason?.trim() || null,
          status: 'pending',
          requestedBy: user.id,
          createdBy: user.id,
          updatedBy: user.id,
        })
        .returning({ id: opLogTimeChangeRequests.id });
      requestId = inserted[0]!.id;
    } catch (e) {
      // Partial unique index op_log_time_change_pending_uq.
      if ((e as { code?: string }).code === '23505') {
        throw new ConflictError(
          'This entry already has a change waiting for approval. Ask a manager to decide it first.',
        );
      }
      throw e;
    }

    const meta = await tx
      .select({ code: jobCards.code, opSeq: jcOps.opSeq })
      .from(jcOps)
      .innerJoin(jobCards, eq(jobCards.id, jcOps.jobCardId))
      .where(eq(jcOps.id, row.jcOpId))
      .limit(1);
    const jc = meta[0];
    const was = `${row.logDate}${row.startTime ? ` ${row.startTime.slice(0, 5)}` : ''}`;
    const asked = `${input.logDate}${nextTime ? ` ${nextTime.slice(0, 5)}` : ''}`;
    await emitActivityLog(
      tx,
      {
        action: 'OP_LOG_TIME_CHANGE_REQUESTED',
        entity: 'Op',
        detail:
          `${jc?.code ?? ''} Op #${jc?.opSeq ?? ''} — entry ${row.logNo}, ` +
          `${was} → ${asked} requested (entry unchanged until approved)`,
        refId: jc?.code ?? row.logNo,
      },
      companyId,
      user,
    );

    const [request] = await selectTimeChangeRequests(tx, companyId, { id: requestId, limit: 1 });
    const unchanged = await selectOpLogById(tx, input.id, companyId);
    return { applied: false, opLog: unchanged!, request: request ?? null };
  });
}

// ─── Timing-change approvals (ADR-130) ─────────────────────────────────────

// One projection for both the inbox and the ⏳ marker in the log history, so
// the two can never describe the same request differently. Everything except
// the request's own columns is joined live — nothing about the entry is
// duplicated onto the request beyond the prev_* snapshot, which exists to make
// a stale request visible.
async function selectTimeChangeRequests(
  tx: DbTransaction,
  companyId: string,
  filter: { id?: string; status?: OpLogChangeStatus; jcOpId?: string; limit: number },
): Promise<OpLogTimeChangeRequest[]> {
  const result = await tx.execute(sql`
    SELECT
      r.id                              AS "id",
      r.op_log_id                       AS "opLogId",
      r.jc_op_id                        AS "jcOpId",
      jc.code                           AS "jobCardCode",
      o.op_seq                          AS "opSeq",
      o.operation                       AS "operation",
      l.log_type::text                  AS "logType",
      COALESCE(m.code, l.machine_code_text) AS "machineCode",
      l.qty                             AS "qty",
      l.reject_qty                      AS "rejectQty",
      r.prev_log_date::text             AS "prevLogDate",
      r.prev_start_time::text           AS "prevStartTime",
      r.requested_log_date::text        AS "requestedLogDate",
      r.requested_start_time::text      AS "requestedStartTime",
      r.reason                          AS "reason",
      r.status::text                    AS "status",
      r.requested_by                    AS "requestedBy",
      COALESCE(ru.full_name, ru.email)  AS "requestedByName",
      r.requested_at                    AS "requestedAt",
      r.decided_by                      AS "decidedBy",
      COALESCE(du.full_name, du.email)  AS "decidedByName",
      r.decided_at                      AS "decidedAt",
      r.decision_reason                 AS "decisionReason",
      (l.log_date IS DISTINCT FROM r.prev_log_date
        OR l.start_time IS DISTINCT FROM r.prev_start_time) AS "isStale"
    FROM public.op_log_time_change_requests r
    JOIN public.op_log l ON l.id = r.op_log_id
    JOIN public.jc_ops o ON o.id = r.jc_op_id AND o.deleted_at IS NULL
    JOIN public.job_cards jc ON jc.id = o.job_card_id
    LEFT JOIN public.machines m ON m.id = l.machine_id AND m.deleted_at IS NULL
    LEFT JOIN public.users ru ON ru.id = r.requested_by
    LEFT JOIN public.users du ON du.id = r.decided_by
    WHERE r.company_id = ${companyId}::uuid
      AND r.deleted_at IS NULL
      ${filter.id ? sql`AND r.id = ${filter.id}::uuid` : sql``}
      ${filter.status ? sql`AND r.status = ${filter.status}::public.op_log_change_status` : sql``}
      ${filter.jcOpId ? sql`AND r.jc_op_id = ${filter.jcOpId}::uuid` : sql``}
    ORDER BY r.requested_at ASC
    LIMIT ${filter.limit}
  `);
  return (result as unknown as Array<Record<string, unknown>>).map((r) => ({
    ...r,
    opSeq: Number(r['opSeq']),
    qty: Number(r['qty'] ?? 0),
    rejectQty: Number(r['rejectQty'] ?? 0),
    prevStartTime: r['prevStartTime'] ? String(r['prevStartTime']).slice(0, 8) : null,
    requestedStartTime: r['requestedStartTime']
      ? String(r['requestedStartTime']).slice(0, 8)
      : null,
    requestedAt: asIso(r['requestedAt'] as Date | string | null)!,
    decidedAt: asIso(r['decidedAt'] as Date | string | null),
    isStale: Boolean(r['isStale']),
  })) as unknown as OpLogTimeChangeRequest[];
}

export async function listOpLogTimeChangeRequests(
  input: ListOpLogTimeChangeRequestsQuery,
  user: AuthContext,
): Promise<OpLogTimeChangeRequest[]> {
  const companyId = requireCompany(user);
  return withUserContext(user, (tx) =>
    selectTimeChangeRequests(tx, companyId, {
      ...(input.status ? { status: input.status } : {}),
      ...(input.jcOpId ? { jcOpId: input.jcOpId } : {}),
      limit: input.limit,
    }),
  );
}

// Approve = perform the change the requester asked for. Reject = perform
// nothing and say why. Either way the request leaves 'pending', which frees the
// partial unique index so a fresh correction can be asked for.
export async function decideOpLogTimeChange(
  input: DecideOpLogTimeChangeInput,
  user: AuthContext,
): Promise<OpLogTimeChangeRequest> {
  requireWriteRole(user); // manager/admin only — the whole point of ADR-130
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select()
      .from(opLogTimeChangeRequests)
      .where(
        and(
          eq(opLogTimeChangeRequests.id, input.id),
          eq(opLogTimeChangeRequests.companyId, companyId),
          isNull(opLogTimeChangeRequests.deletedAt),
        ),
      )
      .limit(1);
    const req = rows[0];
    if (!req) throw new NotFoundError('Change request not found');
    if (req.status !== 'pending') {
      throw new ValidationError(`This request was already ${req.status}`);
    }

    if (input.decision === 'approve') {
      const target = await loadTimingTarget(tx, req.opLogId, companyId);
      await applyTimingChange(
        tx,
        target,
        req.requestedLogDate,
        req.requestedStartTime,
        companyId,
        user,
        ' — approved change',
      );
    }

    await tx
      .update(opLogTimeChangeRequests)
      .set({
        status: input.decision === 'approve' ? 'approved' : 'rejected',
        decidedBy: user.id,
        decidedAt: new Date(),
        decisionReason: input.decisionReason?.trim() || null,
        updatedBy: user.id,
      })
      .where(eq(opLogTimeChangeRequests.id, req.id));

    const meta = await tx
      .select({ code: jobCards.code, opSeq: jcOps.opSeq })
      .from(jcOps)
      .innerJoin(jobCards, eq(jobCards.id, jcOps.jobCardId))
      .where(eq(jcOps.id, req.jcOpId))
      .limit(1);
    const jc = meta[0];
    const asked = `${req.requestedLogDate}${
      req.requestedStartTime ? ` ${req.requestedStartTime.slice(0, 5)}` : ''
    }`;
    await emitActivityLog(
      tx,
      {
        action:
          input.decision === 'approve'
            ? 'OP_LOG_TIME_CHANGE_APPROVED'
            : 'OP_LOG_TIME_CHANGE_REJECTED',
        entity: 'Op',
        detail:
          `${jc?.code ?? ''} Op #${jc?.opSeq ?? ''} — time change to ${asked} ` +
          `${input.decision === 'approve' ? 'approved' : 'rejected'}` +
          `${input.decisionReason?.trim() ? `: ${input.decisionReason.trim()}` : ''}`,
        refId: jc?.code ?? req.id,
      },
      companyId,
      user,
    );

    const [decided] = await selectTimeChangeRequests(tx, companyId, { id: req.id, limit: 1 });
    if (!decided) throw new NotFoundError('Change request not found');
    return decided;
  });
}

export async function startOp(input: StartOpInput, user: AuthContext): Promise<RunningOp> {
  requireOpEntryRole(user);
  // Per-department tier gate (op_entry sits in Production). Starting a machine
  // session records shop-floor work → `entry`. Admins bypass.
  await requireFormAccess(user, 'op_entry', 'entry');
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const op = await loadJcOp(tx, input.jcOpId, companyId);
    if (op.opType === 'outsource') {
      throw new ValidationError('Cannot start outsource operation on shop floor');
    }
    const snapshot = await loadAvailability(tx, input.jcOpId);
    if (snapshot.available <= 0) {
      throw new ValidationError('No qty available to start for this operation');
    }
    // Client-material gate: the first op of a JWSO Job Card can only start once
    // client material has been ISSUED to it (ADR-103) — zero issued means the
    // operator cannot even start a session, not just cannot log a qty. Older
    // job cards keep the received-based rule (ADR-096/097).
    const cap = await loadMaterialCap(tx, op, companyId);
    if (cap) {
      const allowed = Math.max(0, snapshot.available - cap.shortfall);
      if (allowed <= 0) {
        throw new ValidationError(
          cap.issuedBased
            ? cap.received === 0
              ? `Cannot start — no client material has been issued to this job card. ` +
                `Issue material from Party Material Issue first (JWSO ${cap.jwCode}).`
              : `Cannot start — all ${cap.received} issued piece(s) are already accounted for. ` +
                `Issue more client material to continue (JWSO ${cap.jwCode}).`
            : `No client material available to start. Received ${cap.received} of ${cap.orderQty} ` +
              `for this part (JWSO ${cap.jwCode}). Record a Party Material GRN first.`,
        );
      }
    }

    let machineCode: string | null = null;
    if (op.machineId) {
      const m = await tx
        .select({ code: machines.code })
        .from(machines)
        .where(eq(machines.id, op.machineId))
        .limit(1);
      machineCode = m[0]?.code ?? null;
    }
    // Text snapshot for the op_log marker below when no machine row resolves.
    // 'QC' is a type label the route builder writes, not a machine (ISSUE-010).
    const startMachineCodeText =
      op.machineCodeText && op.machineCodeText !== 'QC' ? op.machineCodeText : null;

    let inserted;
    try {
      inserted = await tx
        .insert(runningOps)
        .values({
          companyId,
          jcOpId: input.jcOpId,
          machineId: op.machineId,
          isOsp: false,
          operatorId: input.operatorId ?? null,
          operatorName: input.operatorName ?? null,
          startDate: input.startDate,
          startTime: input.startTime,
          shift: input.shift,
          status: 'running',
          createdBy: user.id,
          updatedBy: user.id,
        })
        .returning();
    } catch (e) {
      // Both partial unique indexes (one running per op; one running per
      // non-OSP machine) raise unique_violation = SQLSTATE 23505.
      if ((e as { code?: string }).code === '23505') {
        throw new ConflictError('Operation already running OR machine busy with another op');
      }
      throw e;
    }

    // Also append a 'start' marker to op_log for history (qty=0). It carries the
    // same machine as the session it opens (0095), so the marker and the
    // completion logs that follow it read as one continuous run on one machine.
    await tx.insert(opLog).values({
      companyId,
      jcOpId: input.jcOpId,
      logNo: nextLogNo(),
      logType: 'start',
      logDate: input.startDate,
      shift: input.shift,
      qty: 0,
      rejectQty: 0,
      operatorId: input.operatorId ?? null,
      operatorName: input.operatorName ?? null,
      machineId: op.machineId,
      machineCodeText: machineCode ?? startMachineCodeText,
      startTime: input.startTime,
      remarks: input.remarks ?? null,
      createdBy: user.id,
    });

    const row = inserted[0]!;
    // Resolve job card code for the response shape.
    const jc = await tx
      .select({ code: jobCards.code, opSeq: jcOps.opSeq, operation: jcOps.operation })
      .from(jcOps)
      .innerJoin(jobCards, eq(jobCards.id, jcOps.jobCardId))
      .where(eq(jcOps.id, input.jcOpId))
      .limit(1);
    const meta = jc[0]!;

    // Audit: OP_START (legacy line 5532). machineCode comes from the lookup
    // above; falls back to op.machineId if no machine row resolved.
    const operatorPart = input.operatorName ? ` by ${input.operatorName}` : '';
    const machinePart = machineCode ? ` on ${machineCode}` : '';
    await emitActivityLog(
      tx,
      {
        action: 'OP_START',
        entity: 'Op',
        detail: `${meta.code} Op #${meta.opSeq} — Started${machinePart}${operatorPart}`,
        refId: meta.code,
      },
      companyId,
      user,
    );

    return {
      id: row.id,
      jcOpId: row.jcOpId,
      jobCardCode: meta.code,
      opSeq: meta.opSeq,
      operation: meta.operation,
      machineId: row.machineId,
      machineCode,
      isOsp: row.isOsp,
      operatorId: row.operatorId,
      operatorName: row.operatorName,
      startDate: row.startDate,
      startTime: row.startTime,
      shift: row.shift,
      status: row.status,
      endedAt: row.endedAt instanceof Date ? row.endedAt.toISOString() : null,
    } as RunningOp;
  });
}

// OSP auto-PR generation (ADR-039). Manager/admin only (PR/PO writes are
// gated at RLS to admin/manager — a deliberate DELTA from legacy, where
// operators trigger it on op-start). Delegates to generateOspPrForOp inside a
// single transaction so the PR, optional PO, op link, and audit rows all
// commit or roll back together.
export async function generateOspPr(
  input: GenerateOspPrInput,
  user: AuthContext,
): Promise<GenerateOspPrResult> {
  requireWriteRole(user);
  const companyId = requireCompany(user);
  return withUserContext(user, (tx) => generateOspPrForOp(tx, input.jcOpId, companyId, user));
}

export async function stopOp(runningOpId: string, user: AuthContext): Promise<RunningOp> {
  requireOpEntryRole(user);
  // Per-department tier gate (op_entry sits in Production). Stopping a session
  // commits the produced qty to op_log → `entry`. Admins bypass.
  await requireFormAccess(user, 'op_entry', 'entry');
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select()
      .from(runningOps)
      .where(and(eq(runningOps.id, runningOpId), eq(runningOps.companyId, companyId)))
      .limit(1);
    const row = existing[0];
    if (!row) throw new NotFoundError(`Running op ${runningOpId} not found`);
    if (row.status !== 'running') {
      throw new ValidationError(`Running op already in status "${row.status}"`);
    }
    const updated = await tx
      .update(runningOps)
      .set({ status: 'stopped', endedAt: new Date(), updatedBy: user.id })
      .where(eq(runningOps.id, runningOpId))
      .returning();
    const r = updated[0]!;

    const meta = await tx
      .select({
        code: jobCards.code,
        opSeq: jcOps.opSeq,
        operation: jcOps.operation,
      })
      .from(jcOps)
      .innerJoin(jobCards, eq(jobCards.id, jcOps.jobCardId))
      .where(eq(jcOps.id, r.jcOpId))
      .limit(1);
    const m = meta[0]!;
    let machineCode: string | null = null;
    if (r.machineId) {
      const machineRow = await tx
        .select({ code: machines.code })
        .from(machines)
        .where(eq(machines.id, r.machineId))
        .limit(1);
      machineCode = machineRow[0]?.code ?? null;
    }

    // Audit: OP_STOP (legacy line 5704).
    const machinePart = machineCode ? ` on ${machineCode}` : '';
    await emitActivityLog(
      tx,
      {
        action: 'OP_STOP',
        entity: 'Op',
        detail: `${m.code} Op #${m.opSeq} — Stopped${machinePart}`,
        refId: m.code,
      },
      companyId,
      user,
    );

    return {
      id: r.id,
      jcOpId: r.jcOpId,
      jobCardCode: m.code,
      opSeq: m.opSeq,
      operation: m.operation,
      machineId: r.machineId,
      machineCode,
      isOsp: r.isOsp,
      operatorId: r.operatorId,
      operatorName: r.operatorName,
      startDate: r.startDate,
      startTime: r.startTime,
      shift: r.shift,
      status: r.status,
      endedAt: r.endedAt instanceof Date ? r.endedAt.toISOString() : null,
    } as RunningOp;
  });
}
