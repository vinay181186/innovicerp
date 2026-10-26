// Child-row boxes for the edit-approval engine (ADR-202) — the ONE home of the
// mechanics that let a document's LINES (and an SO's milestones) go for approval
// box by box instead of being refused. Used by the JWSO and SO registries.
//
// Keys (each ≤ 64 chars — the DocumentEditChange `field` limit; a uuid is 36,
// so an attr name must stay ≤ 22 chars):
//   <prefix>:<rowId>:<attr>   one attribute of an existing row    e.g. line:<id>:orderQty
//   <prefix>:add:<n>          a whole NEW row, n = 1-based ordinal among the
//                             id-less rows of the frozen proposed payload. Its
//                             "before" is the row SET it was asked against
//                             (rowSetRef), so a row added / removed by anyone
//                             else before approval marks it superseded.
//   <prefix>:remove:<rowId>   an existing row removed
// Labels (≤ 80 chars, clipped with "…"): "<Row> <no> · <Field>" — the web groups
// boxes on the " · " — "Add line · …", "Remove line <no> · …".
//
// The module supplies the projection (current rows from its LOCKED rows, the
// proposed rows from the payload, both as flat attr → value maps) and how one
// approved attr is copied onto a row; this file builds the DiffFields, the two
// snapshots and the rebuilt row array. The module's own writer then applies the
// rebuilt array, so every guard of a direct edit runs on approval too.

import { createHash } from 'node:crypto';
import type { DiffField } from '../../lib/audit-trail';
import type { DbTransaction } from '../../db/with-user-context';

const LABEL_MAX = 80;

/** Clip a box label to the contract's 80 chars. */
export function clipLabel(s: string): string {
  return s.length <= LABEL_MAX ? s : `${s.slice(0, LABEL_MAX - 1)}…`;
}

export interface ChildAttrSpec {
  /** The key's attr part (≤ 22 chars). */
  attr: string;
  /** Field label from the form / NAMING.md ("Order Qty"). */
  label: string;
  format?: DiffField['format'];
}

export interface ChildBoxSpec {
  /** Key prefix: 'line' | 'ms'. */
  prefix: string;
  /** Row word on labels: 'Line' | 'Lot'. */
  rowWord: string;
  attrs: readonly ChildAttrSpec[];
}

/** One CURRENT row, projected from the locked rows. `values` holds every attr. */
export interface CurrentChild {
  id: string;
  /** The row's number on labels ("Line 3"). */
  no: number | string;
  values: Record<string, unknown>;
  /** The remove box's before value ("ABC-12 × 20"). */
  summary: string;
  /** The remove box's label tail ("ABC-12" → "Remove line 3 · ABC-12"). */
  removeName: string | null;
}

/** One PROPOSED row from the payload. `values` holds ONLY the attrs the payload
 *  touches (absent = not touched, never seen as a change). */
export interface ProposedChild {
  id?: string | undefined;
  values: Record<string, unknown>;
  /** The add box's text ("ABC-12 × 20 · POL 10"). */
  summary: string;
}

export const childKey = (prefix: string, rowId: string, attr: string): string =>
  `${prefix}:${rowId}:${attr}`;
export const childAddKey = (prefix: string, n: number): string => `${prefix}:add:${n}`;
export const childRemoveKey = (prefix: string, rowId: string): string =>
  `${prefix}:remove:${rowId}`;

export type ParsedChildKey =
  | { kind: 'attr'; rowId: string; attr: string }
  | { kind: 'add'; n: number }
  | { kind: 'remove'; rowId: string };

/** Parse a box key of this prefix; null for any other key (a header field). */
export function parseChildKey(prefix: string, key: string): ParsedChildKey | null {
  if (!key.startsWith(`${prefix}:`)) return null;
  const rest = key.slice(prefix.length + 1);
  if (rest.startsWith('add:')) {
    const n = Number(rest.slice(4));
    return Number.isInteger(n) && n > 0 ? { kind: 'add', n } : null;
  }
  if (rest.startsWith('remove:')) return { kind: 'remove', rowId: rest.slice(7) };
  const i = rest.lastIndexOf(':');
  if (i <= 0) return null;
  return { kind: 'attr', rowId: rest.slice(0, i), attr: rest.slice(i + 1) };
}

/** The 1-based add ordinal of every id-less row, in payload order — THE one
 *  numbering behind `<prefix>:add:<n>` (diff, snapshot and apply all use it). */
export function addOrdinals<T extends { id?: string | undefined }>(
  rows: readonly T[],
): Array<{ n: number; row: T }> {
  const out: Array<{ n: number; row: T }> = [];
  for (const row of rows) if (!row.id) out.push({ n: out.length + 1, row });
  return out;
}

/** The DiffFields for the current rows (attr + remove boxes) and the proposed
 *  new rows (add boxes). */
export function childDiffFields(
  spec: ChildBoxSpec,
  current: readonly CurrentChild[],
  proposed: readonly ProposedChild[] | null,
): DiffField[] {
  const word = spec.rowWord.toLowerCase();
  const out: DiffField[] = [];
  for (const c of current) {
    for (const a of spec.attrs) {
      out.push({
        key: childKey(spec.prefix, c.id, a.attr),
        label: clipLabel(`${spec.rowWord} ${c.no} · ${a.label}`),
        ...(a.format ? { format: a.format } : {}),
      });
    }
    out.push({
      key: childRemoveKey(spec.prefix, c.id),
      label: clipLabel(`Remove ${word} ${c.no}${c.removeName ? ` · ${c.removeName}` : ''}`),
    });
  }
  for (const { n, row } of addOrdinals(proposed ?? [])) {
    out.push({
      key: childAddKey(spec.prefix, n),
      label: clipLabel(`Add ${word} · ${row.summary}`),
    });
  }
  return out;
}

/** "ABC-12/B" — the item and the customer's Rev as ONE fact (NAMING: Rev is
 *  never shown alone); "—" when there is no code. */
export function codeRevText(code: string | null, revision: string | null | undefined): string {
  const c = code ?? '—';
  return revision ? `${c}/${revision}` : c;
}

/** What the add boxes of one request are compared against. */
export interface RowSetContext {
  /** How many add boxes the proposed payload carries (id-less rows). */
  addCount: number;
  /** The row ids the request was raised against (frozen with the payload at
   *  request time). Absent → the current rows are the request's rows. */
  requestRowIds?: readonly string[] | undefined;
  /** Box keys EARLIER decide calls on this request already applied. */
  priorApproved?: Iterable<string> | undefined;
}

/**
 * The "before" of every `<prefix>:add:<n>` box: the row SET the request was
 * raised against, as "3 lines on the order (ref 4f2a9c)" — a count a person
 * reads plus a short hash of the row ids. Equal at approval only when nobody
 * else added or removed a row since: this request's OWN approved removes are
 * counted back in and its own approved adds counted out, so approving add 1
 * and then add 2 in two clicks does not supersede add 2.
 */
export function rowSetRef(
  spec: ChildBoxSpec,
  currentIds: readonly string[],
  ctx?: RowSetContext,
): string {
  let ids: string[];
  let extra = 0;
  if (ctx?.requestRowIds) {
    const prior = approvedChildBoxes(spec.prefix, ctx.priorApproved ?? []);
    const asked = new Set(ctx.requestRowIds);
    const live = new Set(currentIds);
    ids = ctx.requestRowIds.filter((id) => live.has(id) || prior.removes.has(id));
    extra = currentIds.filter((id) => !asked.has(id)).length - prior.adds.size;
  } else {
    ids = [...currentIds];
  }
  ids.sort();
  const n = ids.length + extra;
  const ref = createHash('sha1')
    .update(`${ids.join(',')}|${extra}`)
    .digest('hex')
    .slice(0, 6);
  const word = spec.rowWord.toLowerCase();
  return `${n} ${word}${n === 1 ? '' : 's'} on the order (ref ${ref})`;
}

/** Current values: every attr, the row's summary on its remove key, and the
 *  row-set ref (rowSetRef) on each of the request's add keys. */
export function childBefore(
  spec: ChildBoxSpec,
  current: readonly CurrentChild[],
  rowSet?: RowSetContext,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of current) {
    for (const a of spec.attrs) out[childKey(spec.prefix, c.id, a.attr)] = c.values[a.attr] ?? null;
    out[childRemoveKey(spec.prefix, c.id)] = c.summary;
  }
  if (rowSet && rowSet.addCount > 0) {
    const ref = rowSetRef(
      spec,
      current.map((c) => c.id),
      rowSet,
    );
    for (let n = 1; n <= rowSet.addCount; n++) out[childAddKey(spec.prefix, n)] = ref;
  }
  return out;
}

/** The RowSetContext of one prefix's rows from a staged payload. */
export function rowSetContext(
  proposedRows: ReadonlyArray<{ id?: string | undefined }> | undefined,
  requestRowIds: readonly string[] | undefined,
  priorApproved: Iterable<string> | undefined,
): RowSetContext {
  return {
    addCount: addOrdinals(proposedRows ?? []).length,
    requestRowIds,
    priorApproved,
  };
}

/** Proposed values: touched attrs of kept rows, the summary of each new row on
 *  its add key, and null on the remove key of every current row the payload
 *  leaves out (the writers' "absent = removed" merge rule). */
export function childAfter(
  spec: ChildBoxSpec,
  current: readonly CurrentChild[],
  proposed: readonly ProposedChild[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const currentIds = new Set(current.map((c) => c.id));
  const kept = new Set<string>();
  for (const p of proposed) {
    if (!p.id || !currentIds.has(p.id)) continue;
    kept.add(p.id);
    for (const a of spec.attrs) {
      const v = p.values[a.attr];
      if (v !== undefined) out[childKey(spec.prefix, p.id, a.attr)] = v;
    }
  }
  for (const { n, row } of addOrdinals(proposed)) out[childAddKey(spec.prefix, n)] = row.summary;
  for (const c of current) if (!kept.has(c.id)) out[childRemoveKey(spec.prefix, c.id)] = null;
  return out;
}

/** The approved boxes of one prefix, split by kind. */
export interface ApprovedChildBoxes {
  attrs: Map<string, Set<string>>;
  adds: Set<number>;
  removes: Set<string>;
  any: boolean;
}

export function approvedChildBoxes(
  prefix: string,
  approvedFields: Iterable<string>,
): ApprovedChildBoxes {
  const out: ApprovedChildBoxes = {
    attrs: new Map(),
    adds: new Set(),
    removes: new Set(),
    any: false,
  };
  for (const f of approvedFields) {
    const k = parseChildKey(prefix, f);
    if (!k) continue;
    out.any = true;
    if (k.kind === 'add') out.adds.add(k.n);
    else if (k.kind === 'remove') out.removes.add(k.rowId);
    else {
      const set = out.attrs.get(k.rowId) ?? new Set<string>();
      set.add(k.attr);
      out.attrs.set(k.rowId, set);
    }
  }
  return out;
}

/** Is this field a child box of the given prefix? */
export const isChildKey = (prefix: string, field: string): boolean =>
  parseChildKey(prefix, field) !== null;

/**
 * The full row array to replay through the module's writer: every CURRENT row
 * (as `currentInputs`, built from the CURRENT values) except an approved
 * removal, each overwritten ONLY by its approved attrs from the proposed row,
 * then the proposed new rows whose add box was approved. An unapproved /
 * rejected / superseded box therefore keeps the row at its current value, and an
 * unapproved removal keeps the row.
 */
export function rebuildChildRows<T extends { id?: string | undefined }>(
  approved: ApprovedChildBoxes,
  currentInputs: ReadonlyArray<{ id: string; input: T }>,
  proposed: readonly T[],
  applyAttr: (row: T, proposedRow: T, attr: string) => void,
): T[] {
  const proposedById = new Map(proposed.filter((p) => p.id).map((p) => [p.id as string, p]));
  const out: T[] = [];
  for (const c of currentInputs) {
    if (approved.removes.has(c.id)) continue;
    const row = c.input;
    const p = proposedById.get(c.id);
    const attrs = approved.attrs.get(c.id);
    if (p && attrs) for (const attr of attrs) applyAttr(row, p, attr);
    out.push(row);
  }
  for (const { n, row } of addOrdinals(proposed)) if (approved.adds.has(n)) out.push(row);
  return out;
}

class Rehearsed extends Error {
  constructor() {
    super('rehearsal rolled back');
  }
}

/**
 * Run `fn` (a module's REAL writer) inside a savepoint and roll it back — the
 * request-time precheck. Every refusal the writer would give on approval (lines
 * in use, qty below what is already made / dispatched, item locked, Rev going
 * backwards…) is thrown NOW, with the writer's own words, and nothing is kept.
 * The rules live once, in the writer; this never copies them.
 */
export async function rehearseInSavepoint(
  tx: DbTransaction,
  fn: (sp: DbTransaction) => Promise<unknown>,
): Promise<void> {
  try {
    await tx.transaction(async (sp) => {
      await fn(sp);
      throw new Rehearsed();
    });
  } catch (e) {
    if (e instanceof Rehearsed) return;
    throw e;
  }
}
