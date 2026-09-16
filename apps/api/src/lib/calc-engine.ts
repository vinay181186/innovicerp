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
//                 + for an outsource op, the qty accepted at Incoming QC on the
//                 GRNs against its PO line(s) (G9c, gap report 2026-09-16 —
//                 the caller passes that per-op sum in; see
//                 lib/osp-accepted.ts). Without it an outsource op never read
//                 complete here even at 10/10 accepted, and at_vendor stayed
//                 at the full input.
//                 + for an outsource op WITHOUT qcRequired, ALSO the op_log
//                 'qc' accepted qty (ADR-167 review F2 + R1). The qc rows on
//                 an outsource op mean two different things:
//                   qcRequired = false → they are RECOVERED pieces re-entering
//                     the op: a rework-child re-inject (nc-register/recovery.ts
//                     reinjectIntoOriginOp) or a use_as_is close
//                     (nc-register/cascades.ts). That is the only way a vendor
//                     op ever gets a piece back after a GRN reject, so they
//                     ADD to completed (GRN 8 + recovered 2 = 10).
//                   qcRequired = true  → they are the shop's OWN inspection of
//                     the SAME pieces the GRN already counted. They must NOT
//                     add (GRN 5 + shop QC 5 is 5 pieces back, not 10); they
//                     feed qcAccepted / qcPending only.
//                 Mirrors v_jc_op_status.completed_qty (0130):
//                   r.completed_qty + orr.osp_accepted_qty
//                     + CASE WHEN op_type = 'outsource' THEN r.qc_accepted_qty END
//                 (the view's add-on is unconditional; the review-R1 split on
//                 qcRequired is applied here — see the F2 block in enrichOps).
//   qcBar       = op_log complete + GRN accepted (never the qc rows) — the qty
//                 shop QC has to accept in full when qcRequired. Same as the
//                 view's complete gate / qc_pending base:
//                   r.completed_qty + orr.osp_accepted_qty
//   qcAccepted  = sum(qty) of op_log rows where log_type='qc'
//   qcRejected  = sum(reject_qty) of op_log rows where log_type='qc'
//   inputAvail  = first op? jc.orderQty : previous op's "output" (qcAccepted if
//                 qcRequired, else completed)
//   available   = max(0, inputAvail - completed) + reworkQty
//   qcPending   = QC op:        max(0, inputAvail - qcAccepted - qcRejected)
//                 process+qc:   max(0, qcBar - qcAccepted - qcRejected)
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
  /** Per-op Σ goods_receipt_note_lines.qc_accepted_qty for OUTSOURCE ops
   *  (keyed by jc_ops.id). Optional so every existing caller keeps its
   *  behaviour; pass it to have outsource ops count what the vendor's GRNs
   *  cleared, exactly as v_jc_op_status.completed_qty does (0128). */
  ospAcceptedByOp?: ReadonlyMap<string, number>,
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
    // G9c: an outsource op is "done" by the pieces Incoming QC accepted off its
    // GRNs, not by op_log rows (nobody logs a vendor's work here).
    if (op.opType === 'outsource' && ospAcceptedByOp) {
      completed += ospAcceptedByOp.get(op.id) ?? 0;
    }
    // qcBar: what shop QC must accept in full when qcRequired — op_log
    // complete + GRN accepted, never the qc rows themselves. Same as the
    // view's `r.completed_qty + orr.osp_accepted_qty` (0130).
    const qcBar = completed;
    // ADR-167 review F2 + R1: an outsource op WITHOUT shop QC also counts its
    // op_log 'qc' accepted rows as completed. After a GRN reject the recovered
    // pieces (rework child re-inject, use_as_is) land on the origin op as qc
    // rows — without this the SO screens read 8 of 10 forever and the next op
    // is fed 8. When the op HAS qcRequired those same rows are the shop's own
    // inspection of pieces the GRN already counted, so adding them would
    // double-count (GRN 5 + shop QC 5 → 10 → falsely complete with 5 still at
    // the vendor). View (0130) adds unconditionally:
    //   + CASE WHEN o.op_type = 'outsource' THEN COALESCE(r.qc_accepted_qty, 0) ELSE 0 END
    // — here the add-on is gated on !qcRequired (review R1).
    if (op.opType === 'outsource' && !op.qcRequired) {
      completed += qcAccepted;
    }

    const prev = enriched[i - 1];
    const inputAvail = prev ? outputOf(prev) : jc.orderQty;
    // KNOWN DIVERGENCE from v_jc_op_status since 0088: the view derives
    // outstanding rework live from nc_register (it falls to 0 when the NC is
    // closed), while this pure helper still adds jc_ops.rework_qty, which only
    // ever increments. Callers here (so-status, so-overview) use `available`
    // for rollups, not for the write path, so the drift is cosmetic — but it IS
    // drift. Closing it means feeding NC rows in, which is a bigger change than
    // ADR-112 took on. Recorded as Open there.
    const available = Math.max(0, inputAvail - completed) + op.reworkQty;

    const isQcOp = op.opType === 'qc';
    let qcPending = 0;
    if (isQcOp) {
      qcPending = Math.max(0, inputAvail - qcAccepted - qcRejected);
    } else if (op.qcRequired) {
      // Against qcBar (op_log complete + GRN accepted) — the pieces physically
      // back that shop QC still has to look at. View (0130) qc_pending:
      //   `r.completed_qty + orr.osp_accepted_qty - r.qc_accepted_qty - r.qc_rejected_qty`.
      qcPending = Math.max(0, qcBar - qcAccepted - qcRejected);
    }

    const running = runningOpIds.has(op.id);
    const status = deriveOpStatus({
      opType: op.opType,
      outsourceStatus: op.outsourceStatus,
      qcRequired: op.qcRequired,
      isQcOp,
      completed,
      qcBar,
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
  /** op_log complete + GRN accepted (no qc rows) — the shop-QC bar. */
  qcBar: number;
  inputAvail: number;
  qcAccepted: number;
  qcRejected: number;
  qcPending: number;
  available: number;
  running: boolean;
}

function deriveOpStatus(s: StatusInput): OpStatus {
  if (s.opType === 'outsource') {
    // G9c: every piece the op was fed has come back accepted → complete,
    // whatever the outsource_status stamp says. Only reachable when the caller
    // fed ospAcceptedByOp (or logged complete/qc rows against the op).
    // ADR-167 review F3: an outsource op can carry qcRequired (shop QC on top
    // of the vendor's GRN). Then it is not complete until shop QC has accepted
    // the whole bar — otherwise it would read `complete` while outputOf()
    // feeds 0 forward. Mirrors the view's (0130) complete gate:
    //   NOT qc_required OR r.qc_accepted_qty >= r.completed_qty + orr.osp_accepted_qty
    // With qcRequired, `completed` holds no shop-QC rows (R1), so GRN 5 +
    // shop QC 5 → completed 5 → not complete; GRN 10 + shop QC 10 → complete.
    if (
      s.inputAvail > 0 &&
      s.completed >= s.inputAvail &&
      (!s.qcRequired || s.qcAccepted >= s.qcBar)
    ) {
      return 'complete';
    }
    // View (0130) next branch: qc_required AND qc_pending > 0 → 'qc_pending'.
    // Review R3: only once the pieces are BACK (stamp 'received', or the bar
    // already covers the whole input). A half-returned op (GRN 5 of 10, shop
    // QC outstanding on those 5) must keep reading outsource_at_vendor so
    // so-status / so-overview keep counting atVendorQty for the other 5.
    if (
      s.qcRequired &&
      s.qcPending > 0 &&
      (s.outsourceStatus === 'received' || s.qcBar >= s.inputAvail)
    ) {
      return 'qc_pending';
    }
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
