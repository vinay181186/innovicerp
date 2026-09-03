// Shared JC write-payload builder.
//
// Extracted verbatim from JobCardForm.onSubmit (job-card-form.tsx) so the
// create/edit form AND the mode-switched JC Status edit branch build the SAME
// `JobCardWriteInput` and run the SAME validation. This is production save
// logic — keep it a single source of truth rather than duplicating it per
// screen (client-side mirror of the server's addJC/editJC validations).

import type { JcOpInput, JobCardWriteInput } from '@innovic/shared';

/** Minimal editable op shape the builder needs. Both the create/edit form's
 *  `FormOp` and the status edit branch's op row are structurally assignable. */
export interface BuildJcOpValues {
  id?: string;
  machineCode: string;
  operation: string;
  opType: 'process' | 'qc' | 'outsource';
  cycleTimeMin: number;
  program: string;
  toolNo: string;
  toolDetails: string;
  qcRequired: boolean;
  outsourceVendorCode: string;
  outsourceCost: number | null;
}

/** Minimal QC-doc shape the builder needs. */
export interface BuildJcDocValues {
  id?: string;
  docType: string;
  fileName: string;
  storagePath: string;
  fileSize: number | null;
}

export interface BuildJcWriteInputArgs {
  isEdit: boolean;
  jcDate: string;
  sourceType: 'so' | 'jw' | null;
  sourceLineId: string | null;
  itemCode: string;
  /** Raw text from the Order Qty input; coerced to Number here. */
  orderQty: string;
  priority: 'normal' | 'high';
  dueDate: string;
  drawingFilePath: string | null;
  remarks: string;
  /** Raw material — both optional and INDEPENDENT (Grade master / Size master).
   *  The id is the link, the *Text snapshot is what the printed Job Card still
   *  carries after a master row is renamed or deactivated. Optional on this
   *  builder so the JC Status edit branch can simply carry the model's values
   *  through: leaving them out of the payload would blank the columns on save. */
  rawMaterialGradeId?: string | null;
  rawMaterialGradeText?: string | null;
  rawMaterialSizeId?: string | null;
  rawMaterialSizeText?: string | null;
  ops: BuildJcOpValues[];
  docs: BuildJcDocValues[];
}

export type BuildJcWriteInputResult =
  | { ok: true; payload: JobCardWriteInput }
  | { ok: false; error: string };

/** Validate the form values and build the JC write payload. Returns a
 *  discriminated result so the caller can surface the first validation error
 *  exactly as the form did (setError + return). No side effects. */
export function buildJcWriteInput(args: BuildJcWriteInputArgs): BuildJcWriteInputResult {
  const {
    isEdit,
    jcDate,
    sourceType,
    sourceLineId,
    itemCode,
    orderQty,
    priority,
    dueDate,
    drawingFilePath,
    remarks,
    rawMaterialGradeId,
    rawMaterialGradeText,
    rawMaterialSizeId,
    rawMaterialSizeText,
    ops,
    docs,
  } = args;

  // Governance: manual create is JW-only. SO items go via Planning.
  if (!isEdit && (sourceType !== 'jw' || !sourceLineId)) {
    return {
      ok: false,
      error:
        'Pick a Job Work Sales Order (JWSO). Sales Order items are created via Planning (execute a plan), not here.',
    };
  }
  const qty = Number(orderQty);
  if (!itemCode || !qty || qty <= 0) {
    return { ok: false, error: 'Fill Item Code and a positive Order Qty.' };
  }
  // Client-side mirror of addJC op validations.
  for (const o of ops) {
    if (o.opType === 'process' && (!o.machineCode || !o.operation)) {
      return { ok: false, error: 'All in-house operations need machine and operation name.' };
    }
    if (o.opType === 'qc' && !o.operation) {
      return { ok: false, error: 'All QC operations need a process name.' };
    }
    if (o.opType === 'outsource' && !o.outsourceVendorCode) {
      return { ok: false, error: 'All outsource operations need a vendor selected.' };
    }
  }
  const payload: JobCardWriteInput = {
    jcDate,
    sourceSoLineId: sourceType === 'so' ? sourceLineId : null,
    sourceJwLineId: sourceType === 'jw' ? sourceLineId : null,
    itemCode,
    orderQty: qty,
    priority,
    dueDate: dueDate || null,
    drawingFilePath,
    remarks: remarks.trim() || null,
    rawMaterialGradeId: rawMaterialGradeId ?? null,
    rawMaterialGradeText: rawMaterialGradeText || null,
    rawMaterialSizeId: rawMaterialSizeId ?? null,
    rawMaterialSizeText: rawMaterialSizeText || null,
    ops: ops.map(
      (o): JcOpInput => ({
        id: o.id,
        machineCode: o.opType === 'process' ? o.machineCode || null : null,
        operation: o.operation,
        opType: o.opType,
        cycleTimeMin: o.cycleTimeMin || 0,
        program: o.program || null,
        toolNo: o.toolNo || null,
        toolDetails: o.toolDetails || null,
        qcRequired: o.opType === 'qc' ? true : o.qcRequired,
        outsourceVendorCode: o.opType === 'outsource' ? o.outsourceVendorCode || null : null,
        outsourceCost: o.opType === 'outsource' ? o.outsourceCost || 0 : 0,
      }),
    ),
    // Only the freshly-uploaded docs (those without an id) are new; existing
    // ones are already registered. The server dedups by storage path anyway.
    qcDocs: docs
      .filter((d) => !d.id && d.storagePath)
      .map((d) => ({
        docType: d.docType,
        fileName: d.fileName,
        storagePath: d.storagePath,
        fileSize: d.fileSize,
      })),
  };
  return { ok: true, payload };
}
