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
// jc_ops directly. The generated terminal QC op carries no durable id and gets no
// box; it is re-attached (with its id) as the last op and re-derived by the writer.

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
  terminalQcOp,
  withoutTerminalQcOp,
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
  /** The frozen proposed operations (terminal QC op excluded), so applyEdit can
   *  read an approved attribute's / added op's value. */
  proposedOps: JcOpInput[];
}

/** The proposed routing from a request payload, minus the generated terminal QC. */
const proposedOpsOf = (input: unknown): JcOpInput[] | undefined => {
  const ops = (input as { ops?: JcOpInput[] } | undefined)?.ops;
  return ops === undefined ? undefined : withoutTerminalQcOp(ops);
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
      .where(and(eq(jobCards.id, id), eq(jobCards.companyId, companyId), isNull(jobCards.deletedAt)))
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
    const allOps = await loadJcOpsForEdit(tx, companyId, id, { lock: true });
    const ops = withoutTerminalQcOp(allOps);

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
    return {
      approvedHeader,
      approvedOps,
      proposedOps: proposedOpsOf(proposedPayload) ?? [],
    } satisfies JcFilteredInput;
  },

  // `expectedUpdatedAt` is unused: updateJobCardTx has no updated_at guard, and the
  // engine's FOR UPDATE lock (held from loadForDiff) is the concurrency guard.
  async applyEdit(tx, companyId, id, filteredInput, _expectedUpdatedAt, user) {
    const { approvedHeader, approvedOps, proposedOps } = filteredInput as JcFilteredInput;

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
      .where(and(eq(jobCards.id, id), eq(jobCards.companyId, companyId), isNull(jobCards.deletedAt)))
      .limit(1);
    const head = headRows[0];
    if (!head) throw new NotFoundError('Job Card not found. It may have been moved to Trash.');

    // ADR-220 - rebuild the routing from the CURRENT ops (jc_ops are already
    // locked by loadForDiff in this transaction). Everything not approved keeps its
    // current value; the writer then runs every guard exactly as a direct edit.
    const currentAll = await loadJcOpsForEdit(tx, companyId, id);
    const terminal = terminalQcOp(currentAll);
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
    const ops: JcOpInput[] = withoutTerminalQcOp(currentAll)
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
    // them that is (now) in the routing - the position the person gave them.
    const inserted = new Map<number, JcOpInput>();
    for (const idx of [...approvedOps.adds].sort((x, y) => x - y)) {
      const prop = proposedOps[idx];
      if (!prop || prop.id) continue;
      let at = 0;
      for (let j = idx - 1; j >= 0; j -= 1) {
        const prev = proposedOps[j]!;
        const pos = prev.id
          ? ops.findIndex((o) => o.id === prev.id)
          : ops.indexOf(inserted.get(j) as JcOpInput);
        if (pos >= 0) {
          at = pos + 1;
          break;
        }
      }
      const added: JcOpInput = { ...prop };
      inserted.set(idx, added);
      ops.splice(at, 0, added);
    }
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
