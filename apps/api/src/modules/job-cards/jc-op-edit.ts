// Job Card OPERATION edits — the shared vocabulary (ADR-220).
//
// ADR-220: an operation change on a LIVE Job Card is no longer refused while the
// Document Edit Approval gate is on. Each change becomes its OWN approvable box
// (the owner rejected one combined box), and it rides the SAME ops-edit logic a
// direct edit uses — the writer (updateJobCardTx) still runs every guard; the
// approval engine only chooses WHICH of the proposed changes reach it.
//
// This file is deliberately pure (no database imports) and is shared by both
// sides so there is ONE definition of each rule:
//   - job-cards/service.ts                — the writer + the staging pre-checks
//   - job-cards/jobcard-edit-registry.ts  — the edit-approval engine entry
// Importing it from both avoids a module cycle (the registry imports the
// service; the service must not import the registry).
//
// THE KEYS. The engine stores one change per `field` key (max 64 chars, enforced
// by decideDocumentEditInputSchema), so every key here is length-checked:
//   op:<jcOpId>:<attr>   one attribute of an existing operation (3+36+1+19 = 59 max)
//   op:remove:<jcOpId>   the operation is removed               (10+36     = 46)
//   op:add:<index>       an operation is added, keyed by its position in the
//                        FROZEN proposed payload — an added op has no id yet,
//                        and that payload never changes after staging, so the
//                        index is the only stable handle it has.
//
// `jc_ops.op_seq` is NOT an identity: the writer renumbers every kept op to its
// position in the payload on every save, so "Op 30" can mean a different
// operation after one removal. Only `jc_ops.id` identifies an operation, which
// is why the keys carry the id and the LABEL carries the operation NAME.

import { fmtOpSrNo, isGeneratedTerminalQcOp } from '@innovic/shared';

// Outsource statuses that mean the op is committed on its own, independent of
// the PR row: a PO has been issued, or material has physically moved to the
// vendor. 'pending' / 'pr_raised' are pre-PO intent only — they commit the op
// solely while the PR behind them is still alive (ADR-101).
const OSP_MOVED_STATUSES: ReadonlySet<string> = new Set(['po_created', 'sent', 'received']);

/** The jc_ops columns (plus its PR's state) the commitment rule reads. */
export interface JcOpCommitmentRow {
  outsourceStatus: string | null;
  outsourcePrId: string | null;
  outsourcePoLineId: string | null;
  prStatus: string | null;
  prDeletedAt: Date | string | null;
}

/**
 * COMMITTED = an outsource op whose PR / PO / DC paperwork already points at it;
 * removing, retyping or moving it would orphan that paperwork.
 *
 * ADR-101: only LIVE paperwork commits an op. Cancelling the PR is exactly how a
 * user frees a mistaken outsource op, so a `pr_raised` stamp whose PR was later
 * cancelled (or soft-deleted) is stale and must not keep the op frozen. Real
 * commitments still latch: a PO line pointing at the op, or a status past PO
 * issue (material has physically moved to the vendor).
 *
 * ONE definition, used by updateJobCardTx's lock guard AND by the edit-approval
 * entry's eligibility test (ADR-220) — a second copy would drift.
 */
export function isJcOpCommitted(o: JcOpCommitmentRow): boolean {
  return (
    o.outsourcePoLineId != null ||
    OSP_MOVED_STATUSES.has(o.outsourceStatus ?? '') ||
    (o.outsourcePrId != null && o.prDeletedAt == null && o.prStatus !== 'cancelled')
  );
}

/** The subject phrase the locked-op messages are built on: "Op 30 — it already
 *  has logged work" / "Op 30 — its PR / PO exists. Cancel it first". `started`
 *  wins over `committed` so the logged-work reason shows when both apply.
 *  Shared so the writer's refusal and the staging refusal read identically. */
export function jcLockedOpSubject(opSeq: number, isStarted: boolean): string {
  // display rule — see opSrNo in @innovic/shared
  return isStarted
    ? `Op ${fmtOpSrNo(opSeq)} — it already has logged work`
    : `Op ${fmtOpSrNo(opSeq)} — its PR / PO exists. Cancel it first`;
}

/** The attributes of an EXISTING operation that can go for approval, in the
 *  order the approver sees them. Each maps to one stored jc_ops column, so the
 *  before → after a box shows is that column's own before → after. */
export const JC_OP_EDIT_ATTRS = [
  'operation',
  'opType',
  'machineCode',
  'outsourceVendorCode',
  'cycleTimeMin',
  'program',
  'toolNo',
  'toolDetails',
  'qcRequired',
  'outsourceCost',
] as const;
export type JcOpEditAttr = (typeof JC_OP_EDIT_ATTRS)[number];

/** Screen labels, taken from the Job Card's own op table (jc-create-ops-table /
 *  jc-edit-op-row) so the approval box names the field the person edited. */
export const JC_OP_ATTR_LABEL: Record<JcOpEditAttr, string> = {
  operation: 'Operation',
  opType: 'Type',
  machineCode: 'Machine',
  outsourceVendorCode: 'Vendor',
  cycleTimeMin: 'Cycle Time (min)',
  program: 'Program No.',
  toolNo: 'Tool No.',
  toolDetails: 'Tool Details',
  qcRequired: 'QC Required',
  outsourceCost: 'Cost/pc',
};

/** What the approver reads for an op type (the box shows words, not enum codes). */
export const JC_OP_TYPE_LABEL: Record<string, string> = {
  process: 'Process',
  qc: 'QC',
  outsource: 'OSP',
};

/** Hard cap from documentEditChangeSchema (`field` max 64). Every key builder
 *  runs through here, so a longer attribute name can never ship a key the decide
 *  route would reject. */
const KEY_MAX = 64;
const checkedKey = (key: string): string => {
  if (key.length > KEY_MAX) {
    throw new Error(`Job Card op edit key is too long (${key.length} > ${KEY_MAX}): ${key}`);
  }
  return key;
};

export const jcOpAttrKey = (jcOpId: string, attr: JcOpEditAttr): string =>
  checkedKey(`op:${jcOpId}:${attr}`);
export const jcOpRemoveKey = (jcOpId: string): string => checkedKey(`op:remove:${jcOpId}`);
export const jcOpAddKey = (index: number): string => checkedKey(`op:add:${index}`);

export type JcOpEditKey =
  | { kind: 'attr'; jcOpId: string; attr: JcOpEditAttr }
  | { kind: 'remove'; jcOpId: string }
  | { kind: 'add'; index: number };

/** Read one of the three key shapes back, or null when the key is not an
 *  operation key at all (a header field). 'remove' / 'add' can never collide
 *  with an id — a jc_ops id is a uuid. */
export function parseJcOpEditKey(key: string): JcOpEditKey | null {
  if (!key.startsWith('op:')) return null;
  const parts = key.split(':');
  if (parts.length !== 3) return null;
  const a = parts[1]!;
  const b = parts[2]!;
  if (a === 'remove') return b ? { kind: 'remove', jcOpId: b } : null;
  if (a === 'add') {
    const index = Number(b);
    return Number.isInteger(index) && index >= 0 ? { kind: 'add', index } : null;
  }
  if (!a || !(JC_OP_EDIT_ATTRS as readonly string[]).includes(b)) return null;
  return { kind: 'attr', jcOpId: a, attr: b as JcOpEditAttr };
}

/** `label` is capped at 80 chars (documentEditChangeSchema), so a long operation
 *  name is clipped rather than silently rejected by the decide route. */
const LABEL_MAX = 80;
function clipName(name: string | null, room: number): string {
  const n = (name ?? '').trim();
  if (room < 2 || n === '') return '';
  return n.length <= room ? n : `${n.slice(0, room - 1)}…`;
}

/** "Op 30 CUTTING · Cycle Time (min)". The NAME is in the label on purpose: op
 *  numbers renumber on every save, so a label saying only "Op 30" would point at
 *  a different operation after one removal. */
export function jcOpChangeLabel(
  opSeq: number,
  operation: string | null,
  attrLabel: string,
): string {
  const head = `Op ${fmtOpSrNo(opSeq)}`;
  const tail = ` · ${attrLabel}`;
  const name = clipName(operation, LABEL_MAX - head.length - tail.length - 1);
  return `${head}${name ? ` ${name}` : ''}${tail}`;
}

/** "Op 40 DRILLING (removed)" — the same wording the JC History line uses. */
export function jcOpRemoveLabel(opSeq: number, operation: string | null): string {
  const head = `Op ${fmtOpSrNo(opSeq)}`;
  const tail = ' (removed)';
  const name = clipName(operation, LABEL_MAX - head.length - tail.length - 1);
  return `${head}${name ? ` ${name}` : ''}${tail}`;
}

/** "Op 50 TPI (added)". The number is the op's position in the PROPOSED routing;
 *  if other changes in the same request are rejected the saved number can differ,
 *  which is exactly why the name is in the label too. */
export function jcOpAddLabel(index: number, operation: string | null): string {
  const head = `Op ${fmtOpSrNo(index + 1)}`;
  const tail = ' (added)';
  const name = clipName(operation, LABEL_MAX - head.length - tail.length - 1);
  return `${head}${name ? ` ${name}` : ''}${tail}`;
}

/**
 * The routing WITHOUT the system-generated terminal QC op (ADR-069 Rule B's
 * "Final Inspection"), which is never staged for approval.
 *
 * Why it gets no box of any kind: the server appends that op itself
 * (withTerminalQcOp) and it carries no durable identity — whenever the routing
 * changes in a way that drops it, it is soft-deleted and re-inserted with a NEW
 * id (seen in live data: the same Final Inspection at the same op_seq deleted
 * and re-created 14 minutes apart). Staging it would show the approver a phantom
 * "removed + added" pair on every edit. The writer re-derives it on apply, so
 * leaving it out of the diff is also what keeps it correct.
 *
 * Only the LAST op is considered — that is the one place withTerminalQcOp puts
 * it, so a "Final Inspection" a person deliberately placed mid-route stays an
 * ordinary operation and does get its own boxes. Recognised by the same
 * predicate the writer uses (isGeneratedTerminalQcOp), never by name alone.
 */
export function withoutTerminalQcOp<T extends { opType: string; operation: string }>(
  ops: readonly T[],
): T[] {
  const list = [...ops];
  const last = list[list.length - 1];
  if (last && isGeneratedTerminalQcOp(last)) list.pop();
  return list;
}

/** The generated terminal QC op of a routing, when it has one — the mirror of
 *  withoutTerminalQcOp (applyEdit re-attaches it as the LAST op). */
export function terminalQcOp<T extends { opType: string; operation: string }>(
  ops: readonly T[],
): T | undefined {
  const last = ops[ops.length - 1];
  return last && isGeneratedTerminalQcOp(last) ? last : undefined;
}

/** The op fields the attribute snapshot reads — satisfied by both a stored row
 *  (after mapping) and a proposed JcOpInput. */
export interface JcOpAttrSource {
  operation: string | null | undefined;
  opType: string;
  machineCode?: string | null | undefined;
  outsourceVendorCode?: string | null | undefined;
  cycleTimeMin?: number | string | null | undefined;
  program?: string | null | undefined;
  toolNo?: string | null | undefined;
  toolDetails?: string | null | undefined;
  qcRequired?: boolean | null | undefined;
  outsourceCost?: number | string | null | undefined;
}

const emptyToNull = (v: string | null | undefined): string | null =>
  v == null || v === '' ? null : v;

/** Does this attribute mean anything for an op of this type? The writer stores a
 *  machine only on a process op and a vendor / cost only on an outsource op
 *  (see updateJobCardTx `vals`), so a box for the others would be a phantom. */
export function jcOpAttrApplies(attr: JcOpEditAttr, opType: string): boolean {
  if (attr === 'machineCode') return opType === 'process';
  if (attr === 'outsourceVendorCode' || attr === 'outsourceCost') return opType === 'outsource';
  return true;
}

/**
 * ONE normalisation of an operation's editable attributes, applied to BOTH the
 * stored row and the proposed op, so "changed" means exactly what the writer
 * would store differently: empty = null, machine / vendor / cost only for the
 * type that keeps them, a QC op always has qcRequired, cycle time numeric.
 * An attribute that does not apply to the type is null.
 */
export function jcOpAttrSnapshot(o: JcOpAttrSource): Record<JcOpEditAttr, unknown> {
  const t = o.opType;
  return {
    operation: emptyToNull(o.operation),
    opType: t,
    machineCode: t === 'process' ? emptyToNull(o.machineCode) : null,
    outsourceVendorCode: t === 'outsource' ? emptyToNull(o.outsourceVendorCode) : null,
    cycleTimeMin: Number(o.cycleTimeMin || 0),
    program: emptyToNull(o.program),
    toolNo: emptyToNull(o.toolNo),
    toolDetails: emptyToNull(o.toolDetails),
    qcRequired: t === 'qc' ? true : Boolean(o.qcRequired),
    outsourceCost: t === 'outsource' ? Number(o.outsourceCost || 0) : null,
  };
}
