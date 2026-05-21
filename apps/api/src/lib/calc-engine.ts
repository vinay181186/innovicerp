// Calc-engine — pure aggregation helpers for the Planning module (PL-1..PL-5).
//
// Ports legacy `calcEngine()` at HTML L1626. The function name in legacy is a
// monolith that walks `db.jcOps`, `db.opLog`, `db.runningOps`, and `db.jobCards`
// once and returns enriched per-op + per-JC rollups. This port splits it into
// pure functions so the so-status service (and later sales-overview, plan
// dashboard, etc) can call into the same primitives without re-implementing
// the math.
//
// NO DB access here. Caller batches the reads (one round of queries against
// ops + op_log + running_ops + job_cards) and passes the rows in. Tests
// hammer this file with synthetic fixtures — no Postgres needed.
//
// Math primer (mirrors legacy):
//   completed   = sum(qty) of op_log rows where log_type='complete'
//   qcAccepted  = sum(qty) of op_log rows where log_type='qc'
//   qcRejected  = sum(reject_qty) of op_log rows where log_type='qc'
//   inputAvail  = first op? jc.orderQty : previous op's "output" (qcAccepted if
//                 qcRequired, else completed)
//   available   = max(0, inputAvail - completed) + reworkQty
//   qcPending   = QC op:        max(0, inputAvail - qcAccepted - qcRejected)
//                 process+qc:   max(0, completed - qcAccepted - qcRejected)
//                 neither:      0
//
// Status priorities for one op:
//   outsource  → outsource_pending / pr_raised / po_created / at_vendor / received
//   qc op      → complete (input fully resolved) | qc_pending | available | waiting
//   process op → running > qc_pending > complete > in_progress > available > waiting

import type { jcOps, jobCards, opLog } from '../db/schema';

type JcRow = typeof jobCards.$inferSelect;
type JcOpRow = typeof jcOps.$inferSelect;
type OpLogRow = typeof opLog.$inferSelect;

export type OpStatus =
  | 'complete'
  | 'qc_pending'
  | 'running'
  | 'in_progress'
  | 'available'
  | 'waiting'
  | 'outsource_pending'
  | 'outsource_pr_raised'
  | 'outsource_po_created'
  | 'outsource_at_vendor'
  | 'outsource_received';

export type JcStatus = 'complete' | 'qc_pending' | 'in_progress' | 'no_ops';

export interface EnrichedOp {
  id: string;
  jobCardId: string;
  opSeq: number;
  operation: string;
  opType: JcOpRow['opType'];
  machineId: string | null;
  machineCodeText: string | null;
  outsourceStatus: JcOpRow['outsourceStatus'];
  outsourcePrId: string | null;
  outsourcePoLineId: string | null;
  qcRequired: boolean;
  reworkQty: number;
  completed: number;
  qcAccepted: number;
  qcRejected: number;
  inputAvail: number;
  available: number;
  qcPending: number;
  running: boolean;
  status: OpStatus;
}

export interface JCRollup {
  jobCardId: string;
  ops: EnrichedOp[];
  totalOps: number;
  doneOps: number;
  qcPendOps: number;
  /** Production qty done — last op's qcAccepted (if qcRequired) or completed. */
  doneQty: number;
  remainingQty: number;
  completionPct: number;
  status: JcStatus;
}

/** Output qty of a single op — what flows INTO the next op in seq. */
function outputOf(op: EnrichedOp): number {
  return op.qcRequired ? op.qcAccepted : op.completed;
}

/** Enrich one JC's ops with rolled-up metrics. Ops are sorted by op_seq and
 *  walked left→right so `inputAvail` propagates. Pure; no DB access. */
export function enrichOps(
  jc: JcRow,
  ops: JcOpRow[],
  logs: OpLogRow[],
  runningOpIds: Set<string>,
): EnrichedOp[] {
  const opsSorted = [...ops].sort((a, b) => a.opSeq - b.opSeq);
  const logsByOp = new Map<string, OpLogRow[]>();
  for (const log of logs) {
    const arr = logsByOp.get(log.jcOpId);
    if (arr) arr.push(log);
    else logsByOp.set(log.jcOpId, [log]);
  }

  const enriched: EnrichedOp[] = [];
  for (let i = 0; i < opsSorted.length; i++) {
    const op = opsSorted[i]!;
    const opLogs = logsByOp.get(op.id) ?? [];

    let completed = 0;
    let qcAccepted = 0;
    let qcRejected = 0;
    for (const log of opLogs) {
      if (log.logType === 'complete') {
        completed += log.qty;
      } else if (log.logType === 'qc') {
        qcAccepted += log.qty;
        qcRejected += log.rejectQty;
      }
      // 'start' logs are session markers, don't contribute to qty
    }

    const prev = enriched[i - 1];
    const inputAvail = prev ? outputOf(prev) : jc.orderQty;
    const available = Math.max(0, inputAvail - completed) + op.reworkQty;

    const isQcOp = op.opType === 'qc';
    let qcPending = 0;
    if (isQcOp) {
      qcPending = Math.max(0, inputAvail - qcAccepted - qcRejected);
    } else if (op.qcRequired) {
      qcPending = Math.max(0, completed - qcAccepted - qcRejected);
    }

    const running = runningOpIds.has(op.id);
    const status = deriveOpStatus({
      opType: op.opType,
      outsourceStatus: op.outsourceStatus,
      qcRequired: op.qcRequired,
      isQcOp,
      completed,
      inputAvail,
      qcAccepted,
      qcRejected,
      qcPending,
      available,
      running,
    });

    enriched.push({
      id: op.id,
      jobCardId: op.jobCardId,
      opSeq: op.opSeq,
      operation: op.operation,
      opType: op.opType,
      machineId: op.machineId,
      machineCodeText: op.machineCodeText,
      outsourceStatus: op.outsourceStatus,
      outsourcePrId: op.outsourcePrId,
      outsourcePoLineId: op.outsourcePoLineId,
      qcRequired: op.qcRequired,
      reworkQty: op.reworkQty,
      completed,
      qcAccepted,
      qcRejected,
      inputAvail,
      available,
      qcPending,
      running,
      status,
    });
  }
  return enriched;
}

interface StatusInput {
  opType: JcOpRow['opType'];
  outsourceStatus: JcOpRow['outsourceStatus'];
  qcRequired: boolean;
  isQcOp: boolean;
  completed: number;
  inputAvail: number;
  qcAccepted: number;
  qcRejected: number;
  qcPending: number;
  available: number;
  running: boolean;
}

function deriveOpStatus(s: StatusInput): OpStatus {
  if (s.opType === 'outsource') {
    switch (s.outsourceStatus) {
      case 'pr_raised':
        return 'outsource_pr_raised';
      case 'po_created':
        return 'outsource_po_created';
      case 'sent':
        return 'outsource_at_vendor';
      case 'received':
        return 'outsource_received';
      default:
        return 'outsource_pending';
    }
  }

  if (s.isQcOp) {
    if (s.inputAvail > 0 && s.qcAccepted + s.qcRejected >= s.inputAvail) {
      return 'complete';
    }
    if (s.qcPending > 0) return 'qc_pending';
    return s.inputAvail > 0 ? 'available' : 'waiting';
  }

  if (s.running) return 'running';

  if (s.qcRequired) {
    if (s.qcPending > 0) return 'qc_pending';
    if (
      s.inputAvail > 0 &&
      s.completed >= s.inputAvail &&
      s.qcAccepted >= s.completed
    ) {
      return 'complete';
    }
  } else if (s.inputAvail > 0 && s.completed >= s.inputAvail) {
    return 'complete';
  }

  if (s.inputAvail > 0 && s.available > 0) {
    return s.completed > 0 ? 'in_progress' : 'available';
  }
  return 'waiting';
}

/** Roll up one JC from its enriched ops. */
export function rollupJC(jc: JcRow, ops: EnrichedOp[]): JCRollup {
  const totalOps = ops.length;
  const doneOps = ops.filter((o) => o.status === 'complete').length;
  const qcPendOps = ops.filter((o) => o.status === 'qc_pending').length;
  const lastOp = ops[ops.length - 1];
  const doneQty = lastOp ? outputOf(lastOp) : 0;
  const remainingQty = Math.max(0, jc.orderQty - doneQty);
  const completionPct =
    jc.orderQty > 0 ? Math.min(100, Math.round((doneQty / jc.orderQty) * 100)) : 0;

  let status: JcStatus;
  if (totalOps === 0) status = 'no_ops';
  else if (doneOps === totalOps) status = 'complete';
  else if (qcPendOps > 0) status = 'qc_pending';
  else status = 'in_progress';

  return {
    jobCardId: jc.id,
    ops,
    totalOps,
    doneOps,
    qcPendOps,
    doneQty,
    remainingQty,
    completionPct,
    status,
  };
}

/** Per-line stage label — what production stage the line is in.
 *  Six values mirror legacy renderSOOverview stage labels. Used by PL-2. */
export type LineStage =
  | 'not_released'
  | 'in_production'
  | 'outsourced'
  | 'quality_check'
  | 'finished'
  | 'hold';

/** Overall SO status — distinct from per-line status; aggregates across all
 *  lines and folds in due-date awareness. Mirrors legacy _deriveSOSummaries
 *  decision tree at HTML L9081-9082. */
export type SoOverallStatus =
  | 'not_started'
  | 'in_progress'
  | 'on_track'
  | 'delayed'
  | 'completed'
  | 'blocked';

/** Derive the 6-state stage label for one line from its JC rollups + ops.
 *  Order of checks matches legacy _deriveBOMItemRow:
 *    hold > finished > quality_check > outsourced > in_production > not_released
 */
export function derivePerLineStage(
  jcRollups: JCRollup[],
  opts: { hold?: boolean } = {},
): LineStage {
  if (opts.hold) return 'hold';
  if (jcRollups.length === 0) return 'not_released';

  const allOps = jcRollups.flatMap((j) => j.ops);
  const allComplete = jcRollups.every((j) => j.status === 'complete');
  if (allComplete) return 'finished';

  const anyQcPending = allOps.some((op) => op.status === 'qc_pending');
  if (anyQcPending) return 'quality_check';

  const anyAtVendor = allOps.some(
    (op) =>
      op.status === 'outsource_at_vendor' ||
      op.status === 'outsource_po_created' ||
      op.status === 'outsource_pr_raised',
  );
  if (anyAtVendor) return 'outsourced';

  const anyInProgress = allOps.some(
    (op) =>
      op.status === 'running' || op.status === 'in_progress' || op.completed > 0,
  );
  if (anyInProgress) return 'in_production';

  return 'not_released';
}

interface OverallStatusInput {
  /** Total qty done across all lines of the SO. */
  totalDoneQty: number;
  /** Total qty required across all lines of the SO. */
  totalRequiredQty: number;
  /** Count of lines in 'hold' stage. */
  holdCount: number;
  /** Count of lines in 'finished' stage. */
  finishedCount: number;
  /** Count of lines whose due_date is in the past AND not yet finished. */
  delayedCount: number;
  /** Number of lines on the SO. */
  lineCount: number;
  /** SO due date (header-level). null acceptable. ISO date string. */
  dueDate: string | null;
  /** Caller-provided "today" for testability. Defaults to runtime now. */
  today?: string;
}

/** Derive the 6-state overall SO status. Mirrors legacy decision tree:
 *  blocked > completed > delayed > on_track (in_progress + on schedule)
 *           > in_progress > not_started
 */
export function deriveOverallSoStatus(input: OverallStatusInput): SoOverallStatus {
  if (input.holdCount > 0) return 'blocked';
  if (input.lineCount > 0 && input.finishedCount === input.lineCount) return 'completed';
  if (input.delayedCount > 0) return 'delayed';

  if (input.totalDoneQty > 0) {
    // On track only if header due-date hasn't passed yet
    const today = input.today ?? new Date().toISOString().slice(0, 10);
    if (input.dueDate && input.dueDate >= today) return 'on_track';
    return 'in_progress';
  }

  return 'not_started';
}

/** Aggregate JC rollups into per-SO-line metrics — used by PL-1 + PL-2. */
export interface SoLineRollup {
  soLineId: string;
  totalJcQty: number;
  doneQty: number;
  remainingQty: number;
  completionPct: number;
  lineStatus: 'no_jc' | 'complete' | 'qc_pending' | 'in_progress';
  jcCount: number;
}

export function rollupSoLine(
  soLineId: string,
  orderQty: number,
  jcRollups: JCRollup[],
): SoLineRollup {
  if (jcRollups.length === 0) {
    return {
      soLineId,
      totalJcQty: 0,
      doneQty: 0,
      remainingQty: orderQty,
      completionPct: 0,
      lineStatus: 'no_jc',
      jcCount: 0,
    };
  }
  const totalJcQty = jcRollups.reduce((s, j) => s + (j.ops[0]?.inputAvail ?? 0), 0);
  const doneQty = jcRollups.reduce((s, j) => s + j.doneQty, 0);
  const remainingQty = Math.max(0, orderQty - doneQty);
  const completionPct =
    orderQty > 0 ? Math.min(100, Math.round((doneQty / orderQty) * 100)) : 0;

  const allComplete = jcRollups.every((j) => j.status === 'complete');
  const anyQcPending = jcRollups.some((j) => j.status === 'qc_pending');
  const lineStatus: SoLineRollup['lineStatus'] = allComplete
    ? 'complete'
    : anyQcPending
      ? 'qc_pending'
      : 'in_progress';

  return {
    soLineId,
    totalJcQty,
    doneQty,
    remainingQty,
    completionPct,
    lineStatus,
    jcCount: jcRollups.length,
  };
}
