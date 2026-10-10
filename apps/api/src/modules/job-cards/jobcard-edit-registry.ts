// JobCard entry for the edit-approval engine (ADR-202, Phase 2c).
//
// HEADER fields (JC_EDIT_FIELDS) AND, since ADR-220, the Job Card's OPERATIONS —
// one approvable box per change, keyed on the operation's own id (jc-op-edit.ts):
//   op:<jcOpId>:<attr>   one attribute of an existing op
//   op:remove:<jcOpId>   the op is removed
//   op:add:<index>       an op is added (index into the frozen proposed payload)
// Boxes are emitted ONLY for ops still eligible (not started, not committed; a
// removal also needs no non-conformance) - the Party GRN pattern. The staging
// pre-check in service.ts (assertJcOpsStageable) refuses everything else, so an
// un-approvable change never becomes a box.
//
// LOCK ORDER (ADR-220; ADR-215 had a real 40P01 deadlock from getting this wrong):
//   1. job_cards row  FOR UPDATE   (loadForDiff)
//   2. jc_ops rows    FOR UPDATE   (loadForDiff, in op_seq order)
//   3. everything updateJobCardTx writes - purchase_requests (autoRaiseOspPrs) etc.
// updateJobCardTx itself now takes job_cards FIRST (it used to write jc_ops before
// job_cards), so the direct path and the approval path agree. executePlan locks the
// PLAN row and only INSERTS new job_cards / jc_ops rows, so it never waits on a lock
// taken here and cannot form a cycle with it.
//
// applyEdit rebuilds the routing from the CURRENT ops, applies only the approved
// boxes, and replays through updateJobCardTx so every guard runs - it never writes
// jc_ops directly. The generated terminal QC op gets no box; it is re-attached
// (with its id) as the last op and re-derived by the writer.
//
// ADR-227: WHICH op that is, is decided by IDENTITY, not by position. The STORED
// routing is stripped by the id it ends with now (loadForDiff strips it there and
// NOTES the id on the target as doc.terminalQcOpId - a record of what the boxes
// exclude, read by nothing; applyEdit re-reads it from the locked rows). The
// PROPOSED routing is stripped by the id the PAYLOAD carries, frozen with it at
// staging time (JC_STAGED_TERMINAL_QC_KEY in jc-op-edit.ts) - never the id
// re-derived at approval time, because that row can be soft-deleted and
// re-inserted with a NEW id in between. Position stopped working the moment the
// person added an operation AFTER the Final Inspection: the stored list still had
// it last, the posted list did not, and each side dropped a different operation.
//
// The three places that project it out of the PROPOSED routing - diffFields,
// afterSnapshot and applyEdit - all go through proposedOpsForStagedKeys, which is
// also the one home of the LEGACY exception: a request staged before the id was
// carried was keyed against the POSITIONAL strip and is read back that way.

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { AccessFormKey, JobCardWriteInput } from '@innovic/shared';
import { jobCards } from '../../db/schema';
import { canSeeFormPrice } from '../../lib/access';
import type { DiffField } from '../../lib/audit-trail';
import { NotFoundError } from '../../lib/errors';
import type { DocEditRegistryEntry, DocEditTarget } from '../document-edits/registry';
import {
  JC_OP_ATTR_LABEL,
  JC_OP_EDIT_ATTRS,
  JC_OP_TYPE_LABEL,
  type JcOpEditAttr,
  jcOpAddKey,
  jcOpAddLabel,
  jcOpAttrApplies,
  jcOpAttrKey,
  jcOpAttrSnapshot,
  jcOpChangeLabel,
  jcOpRemoveKey,
  jcOpRemoveLabel,
  parseJcOpEditKey,
  proposedOpsForStagedKeys,
  stagedTerminalQcOpId,
  terminalQcOp,
  withApprovedOpAdds,
  withoutOpId,
} from './jc-op-edit';
import type { JcOpInput } from './schema';
import {
  JC_EDIT_FIELDS,
  type JcOpEditRow,
  jcOpEditable,
  jcOpRemovable,
  loadJcOpsForEdit,
  updateJobCardTx,
} from './service';

const JC_FORM_KEY: AccessFormKey = 'jc_create';

/** What buildFilteredInput hands applyEdit: only the APPROVED header fields, by
 *  their JC_EDIT_FIELDS key. applyEdit rebuilds the full write from the CURRENT
 *  row + ops and overwrites only these, so a rejected / superseded field keeps
 *  its current value and the operations are never touched. */
interface JcFilteredInput {
  approvedHeader: Record<string, unknown>;
  /** ADR-220 - approved operation boxes, parsed from their keys. */
  approvedOps: {
    attrs: Record<string, JcOpEditAttr[]>;
    removes: string[];
    adds: number[];
  };
  /** The frozen proposed operations EXACTLY as the payload carries them — the
   *  generated terminal QC op still in place. applyEdit strips it by id and only
   *  then indexes into the list, which is what keeps `op:add:<index>` pointing at
   *  the same operation the box was built for. See the note on jcOpAddKey below. */
  proposedOpsRaw: JcOpInput[];
  /** ADR-227 — the generated Final Inspection's id AS IT WAS when the boxes were
   *  built, carried in the frozen payload (JC_STAGED_TERMINAL_QC_KEY). applyEdit
   *  strips `proposedOpsRaw` with THIS id, not with the one it would re-derive
   *  now. `undefined` = a request staged before the id was carried, and only then
   *  does applyEdit fall back to re-deriving it. */
  stagedTerminalQcOpId: string | null | undefined;
}

/**
 * The proposed routing from a request payload, minus the generated terminal QC
 * op — identified by the id the payload CARRIES (ADR-227), never by its position
 * in the posted routing. The browser posts it wherever the person left it, so
 * "the last op" is the wrong operation as soon as something was added after it.
 *
 * A payload with no carried id at all is a LEGACY row whose `op:add:<index>`
 * keys were built with the old positional strip, and it is read back the same
 * way — proposedOpsForStagedKeys owns that split, and is the only place it
 * exists.
 *
 * THE INVARIANT: `op:add:<index>` is an index into THIS list. diffFields,
 * afterSnapshot and applyEdit must therefore all strip the same operation —
 * which is why all three go through proposedOpsForStagedKeys with the payload's
 * own id, and why buildFilteredInput (which cannot see the stored routing) hands
 * the list on UNSTRIPPED for applyEdit to strip.
 */
const proposedOpsOf = (input: unknown): JcOpInput[] | undefined => {
  const ops = (input as { ops?: JcOpInput[] } | undefined)?.ops;
  if (ops === undefined) return undefined;
  return proposedOpsForStagedKeys(ops, stagedTerminalQcOpId(input));
};

const opAttrFormat = (attr: JcOpEditAttr): ((v: unknown) => string | number | null) | undefined => {
  if (attr === 'opType') {
    return (v) => (v == null ? null : (JC_OP_TYPE_LABEL[String(v)] ?? String(v)));
  }
  if (attr === 'qcRequired') return (v) => (v == null ? null : v ? 'Yes' : 'No');
  return undefined;
};

export const jobCardEditRegistryEntry: DocEditRegistryEntry = {
  formKey: JC_FORM_KEY,

  // HEADER fields only, reusing the module's own EDIT diff set + labels. The
  // computed JC status is deliberately NOT here — it is derived, not an edit.
  diffFields(target, proposedInput): readonly DiffField[] {
    const fields: DiffField[] = [...JC_EDIT_FIELDS];
    const ops = (target.doc['ops'] as JcOpEditRow[] | undefined) ?? [];
    const proposed = proposedOpsOf(proposedInput);
    const proposedById = new Map(
      (proposed ?? []).filter((p) => p.id).map((p) => [p.id as string, p]),
    );
    for (const op of ops) {
      if (!jcOpEditable(op)) continue; // started / committed - no box of any kind
      // An attribute gets a box when it applies to the type the op will HAVE
      // (a retype to OSP shows Vendor / Cost; a retype away drops them).
      const type = proposedById.get(op.id)?.opType ?? op.opType;
      for (const attr of JC_OP_EDIT_ATTRS) {
        if (!jcOpAttrApplies(attr, type)) continue;
        const format = opAttrFormat(attr);
        fields.push({
          key: jcOpAttrKey(op.id, attr),
          label: jcOpChangeLabel(op.opSeq, op.operation, JC_OP_ATTR_LABEL[attr]),
          ...(format ? { format } : {}),
        });
      }
      if (jcOpRemovable(op)) {
        fields.push({
          key: jcOpRemoveKey(op.id),
          label: jcOpRemoveLabel(op.opSeq, op.operation),
        });
      }
    }
    (proposed ?? []).forEach((p, i) => {
      if (p.id) return;
      fields.push({ key: jcOpAddKey(i), label: jcOpAddLabel(i, p.operation) });
    });
    return fields;
  },

  async loadForDiff(tx, companyId, id): Promise<DocEditTarget | null> {
    // REQUIRED: lock the job_cards row FOR UPDATE (lock 1 of 2 - see LOCK ORDER
    // in the file header), then the jc_ops rows (lock 2): the diff is derived from
    // them, so they must not change between here and applyEdit.
    const rows = await tx
      .select({
        code: jobCards.code,
        jcDate: jobCards.jcDate,
        orderQty: jobCards.orderQty,
        priority: jobCards.priority,
        dueDate: jobCards.dueDate,
        remarks: jobCards.remarks,
        drawingFilePath: jobCards.drawingFilePath,
        closedAt: jobCards.closedAt,
        updatedAt: jobCards.updatedAt,
        itemCode: sql<
          string | null
        >`(SELECT i.code FROM public.items i WHERE i.id = ${jobCards.itemId})`,
      })
      .from(jobCards)
      .where(
        and(eq(jobCards.id, id), eq(jobCards.companyId, companyId), isNull(jobCards.deletedAt)),
      )
      .limit(1)
      .for('update');
    const jc = rows[0];
    if (!jc) return null;

    // Computed status for the live rule (same view updateJobCardTx reads).
    const statusRows = (await tx.execute(sql`
      SELECT COALESCE(computed_status, 'no_ops') AS s
      FROM public.v_jc_status WHERE job_card_id = ${id}::uuid
    `)) as unknown as Array<{ s: string }>;
    const status = statusRows[0]?.s ?? 'no_ops';

    // ADR-220 - lock 2: the operations, with their eligibility. The generated
    // terminal QC op is projected out (no durable id, no box).
    //
    // ADR-227 - doc.terminalQcOpId below is a RECORD, not an input: it says WHICH
    // jc_ops row was projected out of doc.ops at lock time, so the diff can be
    // read back and understood later. NOTHING strips a routing by it. The STORED
    // routing is already stripped here; the PROPOSED routing is stripped by the id
    // its own payload carries (proposedOpsOf above / the `op:add:<index>` note in
    // buildFilteredInput below), which is a different question and was the bug.
    // Do not wire it into either path, and do not delete it because it looks
    // unused - it is the only trace of which op the boxes exclude.
    const allOps = await loadJcOpsForEdit(tx, companyId, id, { lock: true });
    const terminalQcOpId = terminalQcOp(allOps)?.id ?? null;
    const ops = withoutOpId(allOps, terminalQcOpId);

    return {
      doc: {
        jcDate: jc.jcDate,
        itemCode: jc.itemCode,
        orderQty: jc.orderQty,
        priority: jc.priority,
        dueDate: jc.dueDate,
        remarks: jc.remarks,
        drawingFilePath: jc.drawingFilePath,
        ops,
        terminalQcOpId,
      },
      updatedAt: jc.updatedAt,
      docCode: jc.code,
      // Editable while not complete / closed — the module's own rule. (JC has no
      // 'cancelled' status; a removed card is soft-deleted and filtered out above.)
      isLive: jc.closedAt == null && status !== 'complete' && status !== 'closed',
    };
  },

  beforeSnapshot(target) {
    const d = target.doc;
    const out: Record<string, unknown> = {
      jcDate: d['jcDate'],
      itemCode: d['itemCode'] ?? null,
      orderQty: d['orderQty'],
      priority: d['priority'],
      dueDate: d['dueDate'] ?? null,
      remarks: d['remarks'] ?? null,
      drawingFilePath: d['drawingFilePath'] ?? null,
    };
    for (const op of (d['ops'] as JcOpEditRow[] | undefined) ?? []) {
      const snap = jcOpAttrSnapshot(op);
      for (const attr of JC_OP_EDIT_ATTRS) out[jcOpAttrKey(op.id, attr)] = snap[attr];
      out[jcOpRemoveKey(op.id)] = op.operation;
    }
    return out;
  },

  async afterSnapshot(_tx, _companyId, input, user, target) {
    const i = input as JobCardWriteInput;
    const out: Record<string, unknown> = {};
    // The JC form always posts the whole header, so every key is present; diffFields
    // only yields the ones that actually differ. itemCode is compared as a CODE on
    // both sides (loadForDiff resolves the stored item's code).
    out['jcDate'] = i.jcDate;
    out['itemCode'] = i.itemCode;
    out['orderQty'] = i.orderQty;
    out['priority'] = i.priority;
    out['dueDate'] = i.dueDate ?? null;
    out['remarks'] = i.remarks ?? null;
    out['drawingFilePath'] = i.drawingFilePath ?? null;

    // ADR-220 - operations. An op key ABSENT from `after` is not a change, so a
    // key is written only for what the payload actually says.
    // Stripped exactly as diffFields strips it — both read the id (or the legacy
    // positional rule) off the payload itself, so the two cannot disagree about
    // which operation an `op:add:<index>` points at.
    const proposed = proposedOpsOf(input);
    if (proposed) {
      // Price gate (as PO's rate): a caller who cannot see the cost posts a
      // blinded 0, which must not be read as "cost changed to 0".
      const showMoney = await canSeeFormPrice(user, JC_FORM_KEY);
      const proposedIds = new Set<string>();
      proposed.forEach((p, idx) => {
        if (!p.id) {
          out[jcOpAddKey(idx)] = p.operation;
          return;
        }
        proposedIds.add(p.id);
        const snap = jcOpAttrSnapshot(p);
        for (const attr of JC_OP_EDIT_ATTRS) {
          if (attr === 'outsourceCost' && !showMoney) continue;
          out[jcOpAttrKey(p.id, attr)] = snap[attr];
        }
      });
      // A stored op the payload no longer carries is a removal.
      for (const op of (target?.doc['ops'] as JcOpEditRow[] | undefined) ?? []) {
        if (!proposedIds.has(op.id)) out[jcOpRemoveKey(op.id)] = null;
      }
    }
    return out;
  },

  buildFilteredInput(proposedPayload, approvedFields) {
    const i = proposedPayload as JobCardWriteInput;
    const proposed: Record<string, unknown> = {
      jcDate: i.jcDate,
      itemCode: i.itemCode,
      orderQty: i.orderQty,
      priority: i.priority,
      dueDate: i.dueDate ?? null,
      remarks: i.remarks ?? null,
      drawingFilePath: i.drawingFilePath ?? null,
    };
    const approvedHeader: Record<string, unknown> = {};
    const approvedOps: JcFilteredInput['approvedOps'] = { attrs: {}, removes: [], adds: [] };
    for (const field of approvedFields) {
      const k = parseJcOpEditKey(field);
      if (k) {
        if (k.kind === 'attr') (approvedOps.attrs[k.jcOpId] ??= []).push(k.attr);
        else if (k.kind === 'remove') approvedOps.removes.push(k.jcOpId);
        else approvedOps.adds.push(k.index);
      } else if (field in proposed) {
        approvedHeader[field] = proposed[field];
      }
    }
    const anyOp =
      Object.keys(approvedOps.attrs).length > 0 ||
      approvedOps.removes.length > 0 ||
      approvedOps.adds.length > 0;
    if (Object.keys(approvedHeader).length === 0 && !anyOp) return null;
    // ADR-227 — the operations are handed on UNSTRIPPED. This method is
    // synchronous and gets no target, so it cannot know which op is the stored
    // Final Inspection; applyEdit reads that id from the stored routing and
    // strips it there.
    //
    // WHAT ACTUALLY KEEPS `op:add:<index>` POINTING AT THE SAME OPERATION (it is
    // not an identity this function can guarantee on its own): decideDocumentEdit
    // re-runs loadForDiff — which takes the job_cards row and the jc_ops rows FOR
    // UPDATE — and rebuilds the diff keys from those locked rows in the SAME
    // transaction that then calls applyEdit. So both sides read one and the same
    // stored Final Inspection id, and 'document_edit_pending_uq' allows only one
    // pending request per Job Card, so no second approval can interleave. Every
    // path in the repo today goes through that one entry point, so the indexes
    // agree. Note what does NOT help here: the engine's freshness test compares
    // before-values, and an add has none, so it cannot by itself prove that a
    // staged `op:add:<index>` still points at the same operation. The
    // same-transaction re-derivation above is the whole of the protection.
    //
    // WHAT USED TO BREAK IT, AND WHAT NOW CARRIES IT: anything that changes which
    // jc_ops row is the generated Final Inspection between staging and approval —
    // the ADR-081 in-house/outsource switch writes jc_ops directly and is not
    // covered by 'document_edit_pending_uq', and retyping the last operation drops
    // that row (retyping back inserts a new one with a NEW id). Re-deriving "the
    // id the stored routing ends with NOW" then strips a DIFFERENT op from the
    // frozen payload than the boxes were built against: the stale Final Inspection
    // stays in the list, every index after it is off by one, and the approved
    // addition lands on an op that already has an id. So the id is no longer
    // re-guessed — the staging path freezes it into the payload
    // (JC_STAGED_TERMINAL_QC_KEY) and it is read back here. A request staged
    // BEFORE that key existed carries no id, and its keys were built with the old
    // POSITIONAL strip, so it is read back positionally
    // (proposedOpsForStagedKeys); re-deriving an id for it would resolve an
    // `op:add:<index>` to a different operation altogether.
    return {
      approvedHeader,
      approvedOps,
      proposedOpsRaw: (proposedPayload as { ops?: JcOpInput[] } | undefined)?.ops ?? [],
      stagedTerminalQcOpId: stagedTerminalQcOpId(proposedPayload),
    } satisfies JcFilteredInput;
  },

  // `expectedUpdatedAt` is unused: updateJobCardTx has no updated_at guard, and the
  // engine's FOR UPDATE lock (held from loadForDiff) is the concurrency guard.
  async applyEdit(tx, companyId, id, filteredInput, _expectedUpdatedAt, user) {
    const {
      approvedHeader,
      approvedOps,
      proposedOpsRaw,
      stagedTerminalQcOpId: stagedTerminalId,
    } = filteredInput as JcFilteredInput;

    // Reload the CURRENT header + ops (the engine already holds the row lock), so
    // an unapproved / superseded header field keeps its current value and the
    // operations are resubmitted unchanged — never a stale proposed op change.
    const headRows = await tx
      .select({
        jcDate: jobCards.jcDate,
        orderQty: jobCards.orderQty,
        priority: jobCards.priority,
        dueDate: jobCards.dueDate,
        drawingFilePath: jobCards.drawingFilePath,
        remarks: jobCards.remarks,
        sourceSoLineId: jobCards.sourceSoLineId,
        sourceJwLineId: jobCards.sourceJwLineId,
        rawMaterialGradeId: jobCards.rawMaterialGradeId,
        rawMaterialGradeText: jobCards.rawMaterialGradeText,
        rawMaterialSizeId: jobCards.rawMaterialSizeId,
        rawMaterialSizeText: jobCards.rawMaterialSizeText,
        rawMaterialItemId: jobCards.rawMaterialItemId,
        rmQtyPerPiece: jobCards.rmQtyPerPiece,
        itemCode: sql<
          string | null
        >`(SELECT i.code FROM public.items i WHERE i.id = ${jobCards.itemId})`,
      })
      .from(jobCards)
      .where(
        and(eq(jobCards.id, id), eq(jobCards.companyId, companyId), isNull(jobCards.deletedAt)),
      )
      .limit(1);
    const head = headRows[0];
    if (!head) throw new NotFoundError('Job Card not found. It may have been moved to Trash.');

    // ADR-220 - rebuild the routing from the CURRENT ops (jc_ops are already
    // locked by loadForDiff in this transaction). Everything not approved keeps its
    // current value; the writer then runs every guard exactly as a direct edit.
    const currentAll = await loadJcOpsForEdit(tx, companyId, id);
    const terminal = terminalQcOp(currentAll);
    // ADR-227 — the id that strips the STORED routing: the op that is the
    // generated Final Inspection right now, which is the row this write must put
    // back last.
    const terminalId = terminal?.id ?? null;
    // Stripping the FROZEN PROPOSED payload is a DIFFERENT question, and it is
    // not answered with `terminalId`: `op:add:<index>` indexes the stripped
    // payload, so the strip must match the way those keys were built. The id is
    // frozen into the payload at staging time and used as-is; a legacy row that
    // carries no id is read back POSITIONALLY, the way it was keyed. Re-deriving
    // "the id the stored routing ends with now" is what shifted the indexes and
    // either rolled the decision back or added the wrong operation.
    const proposedOps = proposedOpsForStagedKeys(proposedOpsRaw, stagedTerminalId);
    const toInput = (o: JcOpEditRow): JcOpInput => ({
      id: o.id,
      machineCode: o.opType === 'process' ? o.machineCode : null,
      operation: o.operation,
      opType: o.opType as JcOpInput['opType'],
      cycleTimeMin: o.cycleTimeMin,
      program: o.program,
      toolNo: o.toolNo,
      toolDetails: o.toolDetails,
      qcRequired: o.qcRequired,
      outsourceVendorCode: o.opType === 'outsource' ? o.outsourceVendorCode : null,
      outsourceCost: o.outsourceCost,
    });
    const proposedById = new Map(proposedOps.filter((p) => p.id).map((p) => [p.id as string, p]));
    const removeIds = new Set(approvedOps.removes);
    const kept: JcOpInput[] = withoutOpId(currentAll, terminalId)
      .filter((o) => !removeIds.has(o.id))
      .map((o) => {
        const op = toInput(o);
        const prop = proposedById.get(o.id);
        for (const attr of approvedOps.attrs[o.id] ?? []) {
          if (!prop) continue;
          // Only the approved attribute is overwritten, with the PROPOSED value.
          (op as Record<string, unknown>)[attr] = (prop as Record<string, unknown>)[attr];
        }
        return op;
      });
    // Approved additions go in right after the nearest proposed op in front of
    // them that is (now) in the routing - the position the person gave them. An
    // index that no longer lands on a NEW op THROWS (JC_OP_ADD_UNRESOLVED_MESSAGE):
    // it used to be skipped in silence, so the approval reported success, the
    // operation was never added, and nothing was logged anywhere.
    const ops: JcOpInput[] = withApprovedOpAdds(kept, proposedOps, approvedOps.adds);
    // The generated terminal QC op comes back LAST, with its id, as the form
    // sends it on a direct edit - the writer re-derives / drops it as needed.
    if (terminal) ops.push(toInput(terminal));

    const take = <T>(key: string, fallback: T): T =>
      key in approvedHeader ? (approvedHeader[key] as T) : fallback;

    const payload: JobCardWriteInput = {
      jcDate: take('jcDate', head.jcDate),
      itemCode: take('itemCode', head.itemCode ?? ''),
      orderQty: take('orderQty', Number(head.orderQty)),
      priority: take('priority', head.priority as JobCardWriteInput['priority']),
      dueDate: take('dueDate', head.dueDate ?? null),
      drawingFilePath: take('drawingFilePath', head.drawingFilePath ?? null),
      remarks: take('remarks', head.remarks ?? null),
      // Source is immutable on edit and preserved regardless, but resubmitted so
      // the full write shape is honest.
      sourceSoLineId: head.sourceSoLineId,
      sourceJwLineId: head.sourceJwLineId,
      // Raw material carried through unchanged (the form always sends both sides).
      rawMaterialGradeId: head.rawMaterialGradeId,
      rawMaterialGradeText: head.rawMaterialGradeText,
      rawMaterialSizeId: head.rawMaterialSizeId,
      rawMaterialSizeText: head.rawMaterialSizeText,
      rawMaterialItemId: head.rawMaterialItemId,
      rmQtyPerPiece: head.rmQtyPerPiece == null ? null : Number(head.rmQtyPerPiece),
      ops,
      qcDocs: [],
    };

    await updateJobCardTx(tx, id, payload, user);
  },

  async loadUpdatedAts(tx, companyId, ids) {
    const map = new Map<string, Date | string | null>();
    if (ids.length === 0) return map;
    const rows = await tx
      .select({ id: jobCards.id, updatedAt: jobCards.updatedAt })
      .from(jobCards)
      .where(and(inArray(jobCards.id, ids), eq(jobCards.companyId, companyId)));
    for (const r of rows) map.set(r.id, r.updatedAt);
    return map;
  },
};
