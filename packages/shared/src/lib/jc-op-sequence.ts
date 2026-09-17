// "No QC directly after an OSP step" (user, 2026-09-17).
//
// A part that goes out to a vendor (opType 'outsource') comes back through
// Inward → Incoming QC on the GRN line — that inspection is the QC for the
// vendor's work. A QC op placed IMMEDIATELY after the OSP op on the routing
// would inspect the very same pieces a second time, so the routing must put a
// manufacturing step between them:
//
//   OSP → QC                   ✗ not allowed
//   OSP → Operation → QC       ✓ allowed
//
// QC is not blocked in general — only the pair (outsource, qc) side by side.
//
// SHARED ON PURPOSE. The JC form refuses the routing before it is sent, and
// the API refuses it again on create/edit, plan execute and route-card save,
// with the SAME message, so the person sees one rule wherever it fires.
//
// Two exemptions live with the callers, not here:
//  - rework/repair children (recovery_kind set): the server always appends
//    the terminal QC there, outsource-last routings included (ADR-069 /
//    ADR-161), so callers skip this check for them;
//  - pairs that already exist on a saved document are grandfathered via
//    `allowedPairs`, so an old job card can still be edited without first
//    being re-routed.

import { fmtOpSrNo } from './op-sr-no';

/** The name the server writes as the terminal QC op under ADR-069 Rule B
 *  (was DIR until ADR-168). Owned here so the JC form can recognise the
 *  generated op too; the API re-exports it from lib/jc-default-qc.ts. Must
 *  match a `qc_processes.code` exactly (migration 0132 seeds it). */
export const DEFAULT_FINAL_QC_OP = 'Final Inspection';

export interface SequencedOp {
  /** 'process' | 'qc' | 'outsource' (jc_ops / plan_ops / route_card_ops op_type). */
  opType: string;
  /** Present on ops that already exist in the database. */
  id?: string | null | undefined;
  /** Stored sequence when the caller has it. Plans keep gaps after a delete
   *  (1, 3, 4 …), so the message must name the REAL number, not the index. */
  opSeq?: number | null | undefined;
}

/** Key for a grandfathered (outsource → qc) pair: both ops by their stored id. */
export function opPairKey(outsourceId: string, qcId: string): string {
  return `${outsourceId}>${qcId}`;
}

/** An op as already SAVED on the document (jc_ops row / edit-model op). */
export interface SavedSequencedOp {
  id: string;
  opSeq: number;
  opType: string;
}

/** opPairKey() values for every (outsource, qc) pair that is ALREADY saved
 *  side by side on the document. Ordered by op_seq; only truly consecutive
 *  rows count. Pass the result as `allowedPairs` so the rule only bites on
 *  NEW adjacencies. Used by the JC form and the API alike. */
export function grandfatheredOspQcPairs(
  savedOps: ReadonlyArray<SavedSequencedOp>,
): ReadonlySet<string> {
  const sorted = [...savedOps].sort((a, b) => a.opSeq - b.opSeq);
  const pairs = new Set<string>();
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (prev.opType === 'outsource' && cur.opType === 'qc') pairs.add(opPairKey(prev.id, cur.id));
  }
  return pairs;
}

/** 0-based index of the first QC op that sits directly after an OSP op, or
 *  null when the routing is clean. `allowedPairs` holds opPairKey() values
 *  for pairs already saved that way. */
export function findQcDirectlyAfterOutsource(
  ops: ReadonlyArray<SequencedOp>,
  allowedPairs?: ReadonlySet<string>,
): number | null {
  for (let i = 1; i < ops.length; i++) {
    const prev = ops[i - 1]!;
    const cur = ops[i]!;
    if (prev.opType !== 'outsource' || cur.opType !== 'qc') continue;
    if (allowedPairs && prev.id && cur.id && allowedPairs.has(opPairKey(prev.id, cur.id))) continue;
    return i;
  }
  return null;
}

/** The message shown for the offending QC op at 0-based index `i`. Op numbers
 *  are the ones people see (10, 20, 30 …), taken from the stored `opSeq` when
 *  the caller supplied it, else from the position. */
export function qcAfterOutsourceMessage(i: number, ops?: ReadonlyArray<SequencedOp>): string {
  const qcSeq = ops?.[i]?.opSeq ?? i + 1;
  const ospSeq = ops?.[i - 1]?.opSeq ?? i;
  return `Op ${fmtOpSrNo(qcSeq)} (QC) cannot directly follow Op ${fmtOpSrNo(ospSeq)} (OSP). Add a manufacturing operation between them — the vendor's work is inspected at Incoming QC when it comes back.`;
}

/** Convenience: the message for the first violation, or null when clean. */
export function qcAfterOutsourceError(
  ops: ReadonlyArray<SequencedOp>,
  allowedPairs?: ReadonlySet<string>,
): string | null {
  const i = findQcDirectlyAfterOutsource(ops, allowedPairs);
  return i === null ? null : qcAfterOutsourceMessage(i, ops);
}

/** An op as it comes back on EDIT: the routing as saved, name included. */
export interface EditedOp extends SequencedOp {
  operation: string;
}

/** True when `op` looks like the terminal QC op the server itself appended
 *  (ADR-069 Rule B): a QC step carrying the system-owned name. */
export function isGeneratedTerminalQcOp(op: { opType: string; operation: string }): boolean {
  return (
    op.opType === 'qc' && op.operation.trim().toUpperCase() === DEFAULT_FINAL_QC_OP.toUpperCase()
  );
}

/** On edit, drop the server-generated terminal QC op when it has become STALE
 *  — the routing now holds an outsource op, and Rule B never puts a terminal
 *  QC on such a JC (the vendor's return is credited at Incoming QC; a terminal
 *  QC on top would double-credit). Without this, retyping the op before it to
 *  OSP would trip the "no QC directly after OSP" rule and tell the person to
 *  fix an op they never entered.
 *
 *  Only the LAST op is considered, only when it carries the generated name,
 *  and never when it has logged work (`isStarted`) — a started op is the lock
 *  guards' business, not this helper's. Rework/repair children keep theirs:
 *  the server appends the terminal QC unconditionally there (ADR-161). */
export function stripStaleGeneratedTerminalQc<T extends EditedOp>(
  ops: ReadonlyArray<T>,
  opts: { recoveryKind?: string | null; isStarted?: (op: T) => boolean } = {},
): T[] {
  const list = [...ops];
  if (opts.recoveryKind) return list;
  const last = list[list.length - 1];
  if (!last || !isGeneratedTerminalQcOp(last)) return list;
  if (opts.isStarted?.(last)) return list;
  const head = list.slice(0, -1);
  if (!head.some((o) => o.opType === 'outsource')) return list;
  return head;
}
