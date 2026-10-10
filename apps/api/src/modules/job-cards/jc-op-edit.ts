// Job Card OPERATION edits — the shared vocabulary (ADR-220).
//
// ADR-220: an operation change on a LIVE Job Card is no longer refused while the
// Document Edit Approval gate is on. Each change becomes its OWN approvable box
// (the owner rejected one combined box), and it rides the SAME ops-edit logic a
// direct edit uses — the writer (updateJobCardTx) still runs every guard; the
// approval engine only chooses WHICH of the proposed changes reach it.
//
// This file is deliberately pure (no database imports — only the shared
// vocabulary and the domain error classes) and is shared by both
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
import { ConflictError } from '../../lib/errors';

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
 * The routing WITHOUT the operation carrying `id` — the ONE way the generated
 * terminal QC op (ADR-069 Rule B's "Final Inspection") is taken out of a
 * routing (ADR-227).
 *
 * Why that op is never staged for approval: the server appends it itself
 * (withTerminalQcOp) and it carries no durable identity — whenever the routing
 * changes in a way that drops it, it is soft-deleted and re-inserted with a NEW
 * id (seen in live data: the same Final Inspection at the same op_seq deleted
 * and re-created 14 minutes apart). Staging it would show the approver a phantom
 * "removed + added" pair on every edit. The writer re-derives it on apply, so
 * leaving it out of the diff is also what keeps it correct.
 *
 * Why IDENTITY and never position: the system's own Final Inspection and one a
 * PERSON placed mid-route are identical by name AND by type — only the stored
 * row id tells them apart. The generated one is STORED last, but the browser
 * posts the routing in the order the person arranged it, so stripping "the last
 * op" from each list took DIFFERENT operations out of each as soon as anything
 * sat after it: the stored list lost its Final Inspection, the proposed list
 * kept it, and the comparison reported "the operations changed while you were
 * editing" on an edit that changed nothing of the sort. This is the ONLY form
 * any live code path may use. (The positional form survives for exactly one
 * backward-compatibility case — see
 * withoutTrailingGeneratedTerminalQcLegacyKeys below — and nothing else.)
 *
 * The caller DISCOVERS the id once, from the STORED routing (terminalQcOp), and
 * strips both lists with that one id, so both lists lose the same row. Whether
 * the id is still the right one when an APPROVAL applies it is a separate
 * question, answered in the `op:add:<index>` note in jobcard-edit-registry.ts
 * (buildFilteredInput) — including what would break it.
 *
 * A null / undefined id means "the stored routing has no generated Final
 * Inspection" — nothing is stripped, so a Final Inspection a person added
 * themselves stays an ordinary operation with its own approval boxes.
 */
export function withoutOpId<T extends { id?: string | null | undefined }>(
  ops: readonly T[],
  id: string | null | undefined,
): T[] {
  if (!id) return [...ops];
  return ops.filter((o) => o.id !== id);
}

/** The generated terminal QC op of a STORED routing, when it has one — the only
 *  honest way to learn its id. Position is the whole test: the server puts the
 *  op it appends LAST and nowhere else, so a "Final Inspection" a person placed
 *  mid-route is an ordinary operation with its own approval boxes. Call it on
 *  database rows ordered by op_seq, NEVER on a routing posted by the browser.
 *  applyEdit re-attaches the op this returns as the LAST op. */
export function terminalQcOp<T extends { opType: string; operation: string }>(
  ops: readonly T[],
): T | undefined {
  const last = ops[ops.length - 1];
  return last && isGeneratedTerminalQcOp(last) ? last : undefined;
}

/**
 * LEGACY ONLY — DO NOT CALL THIS ON A FRESH PAYLOAD. ADR-227.
 *
 * The POSITIONAL strip: the routing without its LAST operation, and only when
 * that last operation carries the generated Final Inspection's name and type.
 * This is exactly how the proposed payload was stripped BEFORE the id was
 * carried with it, so it is the only way to read an `op:add:<index>` key that
 * was BUILT that way — the indexes on a request staged back then counted the
 * Final Inspection whenever it was not last in the posted routing (the
 * IN-JC-26-00025 shape: an operation sitting after it).
 *
 * Stripping such a payload by id instead removes the inspection from the MIDDLE
 * of the list and shifts every later index down by one, so a staged
 * `op:add:<index>` resolves to a DIFFERENT element: an element with an id throws
 * and rolls the whole approval decision back, and an element without one would
 * add the WRONG operation.
 *
 * THE FENCE: this is reached only from proposedOpsForStagedKeys below, only when
 * the frozen payload carries no JC_STAGED_TERMINAL_QC_KEY. Every request staged
 * since that key exists goes down the id path, and every other caller must use
 * withoutOpId. There are ZERO pending edit requests on either database today, so
 * nothing live depends on this path — it is here so an old row cannot be applied
 * wrongly.
 */
export function withoutTrailingGeneratedTerminalQcLegacyKeys<
  T extends { opType: string; operation: string },
>(ops: readonly T[]): T[] {
  const list = [...ops];
  const last = list[list.length - 1];
  if (!last || !isGeneratedTerminalQcOp(last)) return list;
  return list.slice(0, -1);
}

/**
 * ADR-227 — the key under which the generated Final Inspection's id rides along
 * INSIDE the frozen proposed payload (`document_edit_requests.proposed_payload`,
 * a jsonb column, so no schema change).
 *
 * WHY it is carried instead of re-derived at approval time: `op:add:<index>` is
 * an index into the proposed routing with that one op stripped out, so the
 * approval must strip the id the payload actually CARRIES — the id that was
 * current when the boxes were built. Re-reading "the id the stored routing ends
 * with now" is a different question, and the two answers part company the moment
 * that row is soft-deleted and re-inserted with a NEW id between staging and
 * approval (the ADR-081 in-house / outsource switch writes jc_ops directly and
 * is not covered by the one-pending-request index). The stale Final Inspection
 * then stays in the stripped list, every later index is off by one, and the
 * approved addition lands on an op that already has an id.
 *
 * The payload is private to the API (it is never projected into a response), so
 * one extra key on it is invisible to the web app.
 */
export const JC_STAGED_TERMINAL_QC_KEY = 'stagedTerminalQcOpId';

/** The staged Final Inspection id attached to a frozen payload.
 *  `undefined` = the key is not there at all (a request staged before ADR-227's
 *  sixth round) and the caller must fall back to re-deriving it; `null` = there
 *  was genuinely no generated Final Inspection when the boxes were built, so
 *  nothing is stripped. */
export function stagedTerminalQcOpId(payload: unknown): string | null | undefined {
  const v = (payload as Record<string, unknown> | null | undefined)?.[JC_STAGED_TERMINAL_QC_KEY];
  if (v === undefined) return undefined;
  return typeof v === 'string' && v !== '' ? v : null;
}

/** The payload as it is frozen for approval, carrying the Final Inspection id
 *  that was current at that moment. Pure; the one writer of that key. */
export function withStagedTerminalQcOpId<T extends object>(
  input: T,
  terminalQcOpId: string | null,
): T & { stagedTerminalQcOpId: string | null } {
  return { ...input, [JC_STAGED_TERMINAL_QC_KEY]: terminalQcOpId };
}

/**
 * THE ONE WAY to strip the FROZEN PROPOSED routing for approval (ADR-227).
 * `op:add:<index>` is an index into the stripped list, so the strip must match
 * the way those keys were BUILT — never the way the stored routing happens to
 * look at approval time.
 *
 * Two shapes of request exist, and they were keyed differently:
 *   - staged WITH the id (every request since the id is frozen into the payload):
 *     strip by that id, wherever the inspection sits in the posted routing. `null`
 *     means the card genuinely had no generated Final Inspection, so nothing is
 *     stripped;
 *   - staged WITHOUT it (`undefined`, a legacy row): the keys were built with the
 *     POSITIONAL strip, so read them with the positional strip
 *     (withoutTrailingGeneratedTerminalQcLegacyKeys). Re-deriving "the id the
 *     stored routing ends with now" and stripping by that is what shifts the
 *     indexes and applies the wrong operation.
 *
 * Every consumer of those indexes — diffFields, afterSnapshot and applyEdit —
 * goes through here, so the three can never disagree about which operation an
 * index points at.
 */
export function proposedOpsForStagedKeys<
  T extends { id?: string | null | undefined; opType: string; operation: string },
>(ops: readonly T[], staged: string | null | undefined): T[] {
  if (staged === undefined) return withoutTrailingGeneratedTerminalQcLegacyKeys(ops);
  return withoutOpId(ops, staged);
}

/** The refusal when an approved `op:add:<index>` no longer points at a NEW
 *  operation in the frozen payload. It used to be skipped in silence: the
 *  approval reported success, the operation was never added and nothing was
 *  logged. An approval must never say "done" and do nothing. */
export const JC_OP_ADD_UNRESOLVED_MESSAGE =
  'This Job Card’s operations changed after the edit was sent for approval, so the new operation could not be added. Reject this edit and make the change again.';

/**
 * The routing with every APPROVED addition spliced in, each one straight after
 * the nearest operation in front of it in the proposed payload that is (still)
 * in the routing — the position the person gave it.
 *
 * `adds` are indexes into `proposedOps` (the frozen proposed routing with the
 * generated Final Inspection stripped out). An index that does not resolve to a
 * NEW op — out of range, or landing on an op that already has an id — means the
 * two sides are no longer indexing the same list, and the addition is THROWN,
 * never dropped.
 *
 * Pure, and exported for its unit tests: this is the one place an approved
 * operation could disappear without a trace.
 */
export function withApprovedOpAdds<T extends { id?: string | null | undefined }>(
  ops: readonly T[],
  proposedOps: readonly T[],
  adds: readonly number[],
): T[] {
  const out = [...ops];
  const inserted = new Map<number, T>();
  for (const idx of [...adds].sort((x, y) => x - y)) {
    const prop = proposedOps[idx];
    // TWO assertions, both required, and neither may be softened:
    //   - the index must still be IN RANGE (`!prop`);
    //   - what it lands on must be a NEW operation, i.e. carry NO id. An entry
    //     WITH an id is an operation that is already stored, so there is nothing
    //     to add — and adding it anyway would duplicate a stored operation. That
    //     is the shape a mis-stripped payload produces (see
    //     proposedOpsForStagedKeys), and it used to be skipped in silence: the
    //     approval reported success and the operation was never added.
    // Refusing rolls the decision back, which is the honest answer — the approver
    // rejects the request and the change is made again.
    //
    // "HAS an id" is the TRUTHY test, matching every sibling that asks the same
    // question of the same payload — diffFields (`if (p.id) return`), afterSnapshot
    // and the `proposedById` maps (`filter((p) => p.id)`). It was `prop.id != null`,
    // which answers differently for an EMPTY-STRING id: the siblings read '' as
    // "no id, this is an addition" and this one read it as "already stored" and
    // threw, aborting the whole approval. The route's schema makes '' unreachable
    // today, so nothing live diverged — but one of four places disagreeing about
    // what an id is, is where the next bug hides.
    if (!prop || prop.id) throw new ConflictError(JC_OP_ADD_UNRESOLVED_MESSAGE);
    let at = 0;
    for (let j = idx - 1; j >= 0; j -= 1) {
      const prev = proposedOps[j]!;
      const pos = prev.id
        ? out.findIndex((o) => o.id === prev.id)
        : out.indexOf(inserted.get(j) as T);
      if (pos >= 0) {
        at = pos + 1;
        break;
      }
    }
    const added = { ...prop };
    inserted.set(idx, added);
    out.splice(at, 0, added);
  }
  return out;
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
