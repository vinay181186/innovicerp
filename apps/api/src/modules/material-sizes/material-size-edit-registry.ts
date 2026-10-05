// Material Size (Raw Material Size Master) entry for the edit-approval engine
// (ADR-202, Phase 2c).
//
// RECORD-level: a Size is a single record with no child lines, so every editable
// field is a header field and there is no line guard. applyEdit replays the
// approved subset through updateMaterialSizeTx, so the edit runs exactly as a
// direct edit. Concurrency is the engine's: loadForDiff locks the row FOR UPDATE
// and the engine rechecks field freshness, so this master needs no updatedAt
// token of its own.
//
// A master has no money column, so there is no price-gated field here — every
// field in MATERIAL_SIZE_EDIT_FIELDS is visible to any editor.

import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { AccessFormKey, UpdateMaterialSizeInput } from '@innovic/shared';
import { materialSizes } from '../../db/schema';
import type { DiffField } from '../../lib/audit-trail';
import type { DocEditRegistryEntry, DocEditTarget } from '../document-edits/registry';
import { MATERIAL_SIZE_EDIT_FIELDS, updateMaterialSizeTx } from './service';

const MATERIAL_SIZE_FORM_KEY: AccessFormKey = 'rawmat_create';

export const materialSizeEditRegistryEntry: DocEditRegistryEntry = {
  formKey: MATERIAL_SIZE_FORM_KEY,

  diffFields(): readonly DiffField[] {
    return MATERIAL_SIZE_EDIT_FIELDS;
  },

  async loadForDiff(tx, companyId, id): Promise<DocEditTarget | null> {
    const rows = await tx
      .select()
      .from(materialSizes)
      .where(
        and(
          eq(materialSizes.id, id),
          eq(materialSizes.companyId, companyId),
          isNull(materialSizes.deletedAt),
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
    const i = input as UpdateMaterialSizeInput;
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
    await updateMaterialSizeTx(tx, id, filteredInput as UpdateMaterialSizeInput, user);
  },

  async loadUpdatedAts(tx, companyId, ids) {
    const map = new Map<string, Date | string | null>();
    if (ids.length === 0) return map;
    const rows = await tx
      .select({ id: materialSizes.id, updatedAt: materialSizes.updatedAt })
      .from(materialSizes)
      .where(and(inArray(materialSizes.id, ids), eq(materialSizes.companyId, companyId)));
    for (const r of rows) map.set(r.id, r.updatedAt);
    return map;
  },
};
