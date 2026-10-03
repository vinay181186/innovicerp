// JobCard entry for the edit-approval engine (ADR-202, Phase 2c).
//
// RECORD/HEADER level only: this pass stages the Job Card's own header fields
// (the exact set + labels the module's EDIT activity diff emits, JC_EDIT_FIELDS).
// A JC's child OPERATIONS are NOT staged — an ops change is refused by the divert
// guard in service.ts (updateJobCardOrStage → jcOpsChanged).
//
// updateJobCard has no parent FOR UPDATE lock and no updated_at guard of its own,
// so loadForDiff below locks the job_cards row FOR UPDATE: the engine holds that
// lock across loadForDiff → applyEdit in one transaction, and THAT is what makes
// an approved Job Card edit safe (the engine-provided concurrency guard). applyEdit
// replays the approved header subset through updateJobCardTx, so every existing JC
// business guard runs exactly as a direct edit.

import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { AccessFormKey, JobCardWriteInput } from '@innovic/shared';
import { jcOps, jobCards } from '../../db/schema';
import type { DiffField } from '../../lib/audit-trail';
import { NotFoundError } from '../../lib/errors';
import type { DocEditRegistryEntry, DocEditTarget } from '../document-edits/registry';
import type { JcOpInput } from './schema';
import { JC_EDIT_FIELDS, updateJobCardTx } from './service';

const JC_FORM_KEY: AccessFormKey = 'jc_create';

/** What buildFilteredInput hands applyEdit: only the APPROVED header fields, by
 *  their JC_EDIT_FIELDS key. applyEdit rebuilds the full write from the CURRENT
 *  row + ops and overwrites only these, so a rejected / superseded field keeps
 *  its current value and the operations are never touched. */
interface JcFilteredInput {
  approvedHeader: Record<string, unknown>;
}

export const jobCardEditRegistryEntry: DocEditRegistryEntry = {
  formKey: JC_FORM_KEY,

  // HEADER fields only, reusing the module's own EDIT diff set + labels. The
  // computed JC status is deliberately NOT here — it is derived, not an edit.
  diffFields(): readonly DiffField[] {
    return [...JC_EDIT_FIELDS];
  },

  async loadForDiff(tx, companyId, id): Promise<DocEditTarget | null> {
    // REQUIRED: lock the job_cards row FOR UPDATE. updateJobCardTx takes no lock
    // of its own, so this is the only thing serialising a staged edit against a
    // concurrent direct edit / approval.
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

    return {
      doc: {
        jcDate: jc.jcDate,
        itemCode: jc.itemCode,
        orderQty: jc.orderQty,
        priority: jc.priority,
        dueDate: jc.dueDate,
        remarks: jc.remarks,
        drawingFilePath: jc.drawingFilePath,
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
    return {
      jcDate: d['jcDate'],
      itemCode: d['itemCode'] ?? null,
      orderQty: d['orderQty'],
      priority: d['priority'],
      dueDate: d['dueDate'] ?? null,
      remarks: d['remarks'] ?? null,
      drawingFilePath: d['drawingFilePath'] ?? null,
    };
  },

  afterSnapshot(_tx, _companyId, input) {
    const i = input as JobCardWriteInput;
    // The JC form always posts the whole header, so every key is present; diffFields
    // only yields the ones that actually differ. itemCode is compared as a CODE on
    // both sides (loadForDiff resolves the stored item's code).
    return Promise.resolve({
      jcDate: i.jcDate,
      itemCode: i.itemCode,
      orderQty: i.orderQty,
      priority: i.priority,
      dueDate: i.dueDate ?? null,
      remarks: i.remarks ?? null,
      drawingFilePath: i.drawingFilePath ?? null,
    });
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
    for (const field of approvedFields) {
      if (field in proposed) approvedHeader[field] = proposed[field];
    }
    if (Object.keys(approvedHeader).length === 0) return null;
    return { approvedHeader } satisfies JcFilteredInput;
  },

  // `expectedUpdatedAt` is unused: updateJobCardTx has no updated_at guard, and the
  // engine's FOR UPDATE lock (held from loadForDiff) is the concurrency guard.
  async applyEdit(tx, companyId, id, filteredInput, _expectedUpdatedAt, user) {
    const { approvedHeader } = filteredInput as JcFilteredInput;

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

    const opRows = await tx
      .select({
        id: jcOps.id,
        machineCodeText: jcOps.machineCodeText,
        operation: jcOps.operation,
        opType: jcOps.opType,
        cycleTimeMin: jcOps.cycleTimeMin,
        program: jcOps.program,
        toolNo: jcOps.toolNo,
        toolDetails: jcOps.toolDetails,
        qcRequired: jcOps.qcRequired,
        outsourceVendorText: jcOps.outsourceVendorText,
        outsourceCost: jcOps.outsourceCost,
      })
      .from(jcOps)
      .where(and(eq(jcOps.jobCardId, id), isNull(jcOps.deletedAt)))
      .orderBy(asc(jcOps.opSeq));

    const ops: JcOpInput[] = opRows.map((o) => ({
      id: o.id,
      machineCode: o.opType === 'process' ? o.machineCodeText : null,
      operation: o.operation,
      opType: o.opType as JcOpInput['opType'],
      cycleTimeMin: Number(o.cycleTimeMin ?? 0),
      program: o.program,
      toolNo: o.toolNo,
      toolDetails: o.toolDetails,
      qcRequired: Boolean(o.qcRequired),
      outsourceVendorCode: o.opType === 'outsource' ? o.outsourceVendorText : null,
      outsourceCost: Number(o.outsourceCost ?? 0),
    }));

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
