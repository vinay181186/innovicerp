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
// ADR-011 #4 makes op_log immutable — corrections happen via a reversing
// entry (e.g. negative-qty record), never an UPDATE. This service has
// listOpLog + createOpLog only; no updateOpLog or deleteOpLog.
//
// Running-ops uniqueness is enforced at the DB layer via the partial unique
// indexes on (company_id, jc_op_id) where status='running' and on
// (machine_id) where status='running' and is_osp=false. The service catches
// the resulting unique-violation and returns a typed ConflictError.

import { and, desc, eq, sql } from 'drizzle-orm';
import { jcOps, jobCards, machines, opLog, runningOps } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireOpEntryRole } from '../../lib/auth';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';
import { tryCascadeJcComplete } from './sales-cascade';
import type {
  JcOpEnriched,
  ListJcOpsQuery,
  ListOpLogQuery,
  ListRunningOpsQuery,
  OpLog,
  RunningOp,
  StartOpInput,
  SubmitOpLogInput,
  SubmitQcLogInput,
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
        o.op_seq               AS "opSeq",
        o.machine_id           AS "machineId",
        m.code                 AS "machineCode",
        o.machine_code_text    AS "machineCodeText",
        o.operation,
        o.op_type              AS "opType",
        o.cycle_time_min::text AS "cycleTimeMin",
        o.qc_required          AS "qcRequired",
        o.qc_call_date         AS "qcCallDate",
        o.qc_attended_date     AS "qcAttendedDate",
        o.rework_qty           AS "reworkQty",
        o.outsource_vendor_id  AS "outsourceVendorId",
        o.outsource_status     AS "outsourceStatus",
        s.completed_qty        AS "completedQty",
        s.qc_accepted_qty      AS "qcAcceptedQty",
        s.qc_rejected_qty      AS "qcRejectedQty",
        s.input_avail          AS "inputAvail",
        s.available            AS "available",
        s.qc_pending           AS "qcPending",
        s.computed_status      AS "computedStatus"
      FROM public.jc_ops o
      JOIN public.job_cards jc ON jc.id = o.job_card_id
      LEFT JOIN public.machines m ON m.id = o.machine_id
      LEFT JOIN public.v_jc_op_status s ON s.jc_op_id = o.id
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
      qcPending: Number(r['qcPending'] ?? 0),
    })) as unknown as JcOpEnriched[];
  });
}

export async function listOpLog(input: ListOpLogQuery, user: AuthContext): Promise<OpLog[]> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select()
      .from(opLog)
      .where(and(eq(opLog.companyId, companyId), eq(opLog.jcOpId, input.jcOpId)))
      .orderBy(desc(opLog.createdAt))
      .limit(input.limit);
    return rows.map((r) => ({
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
      startTime: r.startTime,
      remarks: r.remarks,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
      createdBy: r.createdBy,
    })) as OpLog[];
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
    })
    .from(jcOps)
    .where(and(eq(jcOps.id, jcOpId), eq(jcOps.companyId, companyId)))
    .limit(1);
  const op = rows[0];
  if (!op) throw new NotFoundError(`Op ${jcOpId} not found`);
  return op as JcOpRow;
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

    const snapshot = await loadAvailability(tx, input.jcOpId);
    if (snapshot.computedStatus === 'qc_pending') {
      throw new ValidationError('Operation is waiting for QC clearance — go to QC dashboard');
    }
    if (input.qty > snapshot.available) {
      throw new ValidationError(
        `Qty ${input.qty} exceeds available ${snapshot.available} — cannot exceed planned qty`,
      );
    }

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
        startTime: null,
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
      startTime: row.startTime,
      remarks: row.remarks,
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
        startTime: null,
        remarks: input.remarks ?? null,
        createdBy: user.id,
      })
      .returning();
    const row = inserted[0]!;

    // Cascade: if this QC log brings the JC to complete (last QC op resolved),
    // close the source SO/JW line + header. Idempotent; no-op for source-less
    // JCs or already-closed lines.
    await tryCascadeJcComplete(tx, op.jobCardId, user);

    // Audit emit. Single OP_QC action with both qtys in detail (one log can
    // carry both per legacy; splitting into _ACCEPT/_REJECT loses the link).
    const jcMeta = await tx
      .select({ code: jobCards.code })
      .from(jobCards)
      .where(eq(jobCards.id, op.jobCardId))
      .limit(1);
    const jcCode = jcMeta[0]?.code;
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
      startTime: row.startTime,
      remarks: row.remarks,
      createdAt:
        row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
      createdBy: row.createdBy,
    } as OpLog;
  });
}

export async function startOp(input: StartOpInput, user: AuthContext): Promise<RunningOp> {
  requireOpEntryRole(user);
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

    let machineCode: string | null = null;
    if (op.machineId) {
      const m = await tx
        .select({ code: machines.code })
        .from(machines)
        .where(eq(machines.id, op.machineId))
        .limit(1);
      machineCode = m[0]?.code ?? null;
    }

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

    // Also append a 'start' marker to op_log for history (qty=0).
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

export async function stopOp(runningOpId: string, user: AuthContext): Promise<RunningOp> {
  requireOpEntryRole(user);
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
