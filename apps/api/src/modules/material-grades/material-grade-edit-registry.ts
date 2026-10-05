// Material Grade (Raw Material Grade Master) entry for the edit-approval engine
// (ADR-202, Phase 2c).
//
// RECORD-level: a Grade is a single record with no child lines, so every
// editable field is a header field and there is no line guard. applyEdit replays
// the approved subset through updateMaterialGradeTx, so the edit runs exactly as
// a direct edit. Concurrency is the engine's: loadForDiff locks the row FOR
// UPDATE and the engine rechecks field freshness, so this master needs no
// updatedAt token of its own.
//
// A master has no money column, so there is no price-gated field here — every
// field in MATERIAL_GRADE_EDIT_FIELDS is visible to any editor.

import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { AccessFormKey, UpdateMaterialGradeInput } from '@innovic/shared';
import { materialGrades } from '../../db/schema';
import type { DiffField } from '../../lib/audit-trail';
import type { DocEditRegistryEntry, DocEditTarget } from '../document-edits/registry';
import { MATERIAL_GRADE_EDIT_FIELDS, updateMaterialGradeTx } from './service';

const MATERIAL_GRADE_FORM_KEY: AccessFormKey = 'rawmat_create';

export const materialGradeEditRegistryEntry: DocEditRegistryEntry = {
  formKey: MATERIAL_GRADE_FORM_KEY,

  diffFields(): readonly DiffField[] {
    return MATERIAL_GRADE_EDIT_FIELDS;
  },

  async loadForDiff(tx, companyId, id): Promise<DocEditTarget | null> {
    const rows = await tx
      .select()
      .from(materialGrades)
      .where(
        and(
          eq(materialGrades.id, id),
          eq(materialGrades.companyId, companyId),
          isNull(materialGrades.deletedAt),
        ),
      )
      .limit(1)
      .for('update');
    const row = rows[0];
    if (!row) return null;
    return {
      doc: { ...row },
      updatedAt: row.updatedAt,
      docCode: row.code,
      // A master is editable as long as it is not in Trash.
      isLive: true,
    };
  },

  beforeSnapshot(target) {
    const d = target.doc;
    return {
      name: d['name'],
      description: d['description'],
      isActive: d['isActive'],
    };
  },

  afterSnapshot(_tx, _companyId, input) {
    const i = input as UpdateMaterialGradeInput;
    const out: Record<string, unknown> = {};
    if (i.name !== undefined) out['name'] = i.name;
    if (i.description !== undefined) out['description'] = i.description ?? null;
    if (i.isActive !== undefined) out['isActive'] = i.isActive;
    return Promise.resolve(out);
  },

  buildFilteredInput(proposedPayload, approvedFields) {
    const rec = proposedPayload as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const field of approvedFields) {
      if (rec[field] !== undefined) out[field] = rec[field];
    }
    if (Object.keys(out).length === 0) return null;
    return out;
  },

  async applyEdit(tx, _companyId, id, filteredInput, _expectedUpdatedAt, user) {
    await updateMaterialGradeTx(tx, id, filteredInput as UpdateMaterialGradeInput, user);
  },

  async loadUpdatedAts(tx, companyId, ids) {
    const map = new Map<string, Date | string | null>();
    if (ids.length === 0) return map;
    const rows = await tx
      .select({ id: materialGrades.id, updatedAt: materialGrades.updatedAt })
      .from(materialGrades)
      .where(and(inArray(materialGrades.id, ids), eq(materialGrades.companyId, companyId)));
    for (const r of rows) map.set(r.id, r.updatedAt);
    return map;
  },
};
