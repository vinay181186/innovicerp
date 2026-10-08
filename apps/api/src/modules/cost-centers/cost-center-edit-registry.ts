// CostCenter (Cost Centre master) entry for the edit-approval engine (ADR-202).
//
// RECORD-level: a cost centre is a single record with no child lines, so every
// editable field is a header field and there is no line guard. applyEdit replays
// the approved subset through updateCostCenterTx inside the engine's transaction,
// which already holds the cost-centre row locked FOR UPDATE.
//
// The edit screen's own `expectedUpdatedAt` (ADR-225) is checked twice before
// anything reaches here — when the edit is REQUESTED, and again inside
// updateCostCenterTx — but it is deliberately NOT forwarded on this replay: the
// approver is applying someone else's older request, so the requester's token
// is not the approver's. The lock above plus the engine's field-freshness
// recheck at approval are what guard this path.
//
// A master has no money column, so every field in COST_CENTER_EDIT_FIELDS is
// visible to any editor. `code` is not editable, so it is not diffed.

import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { AccessFormKey, UpdateCostCenterInput } from '@innovic/shared';
import { costCenters } from '../../db/schema';
import type { DiffField } from '../../lib/audit-trail';
import type { DocEditRegistryEntry, DocEditTarget } from '../document-edits/registry';
import { COST_CENTER_EDIT_FIELDS, updateCostCenterTx } from './service';

const COST_CENTER_FORM_KEY: AccessFormKey = 'cc_create';

export const costCenterEditRegistryEntry: DocEditRegistryEntry = {
  formKey: COST_CENTER_FORM_KEY,

  diffFields(): readonly DiffField[] {
    return COST_CENTER_EDIT_FIELDS;
  },

  async loadForDiff(tx, companyId, id): Promise<DocEditTarget | null> {
    const rows = await tx
      .select()
      .from(costCenters)
      .where(
        and(
          eq(costCenters.id, id),
          eq(costCenters.companyId, companyId),
          isNull(costCenters.deletedAt),
        ),
      )
      .limit(1)
      .for('update');
    const cc = rows[0];
    if (!cc) return null;
    return {
      doc: { ...cc },
      updatedAt: cc.updatedAt,
      docCode: cc.code,
      // A master is editable as long as it is not in Trash.
      isLive: true,
    };
  },

  beforeSnapshot(target) {
    const d = target.doc;
    return {
      name: d['name'],
      department: d['department'],
      type: d['type'],
      description: d['description'],
      isActive: d['isActive'],
    };
  },

  afterSnapshot(_tx, _companyId, input) {
    const i = input as UpdateCostCenterInput;
    const out: Record<string, unknown> = {};
    if (i.name !== undefined) out['name'] = i.name;
    if (i.department !== undefined) out['department'] = i.department ?? null;
    if (i.type !== undefined) out['type'] = i.type ?? null;
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
    const filtered = filteredInput as UpdateCostCenterInput;
    await updateCostCenterTx(tx, id, filtered, user);
  },

  async loadUpdatedAts(tx, companyId, ids) {
    const map = new Map<string, Date | string | null>();
    if (ids.length === 0) return map;
    const rows = await tx
      .select({ id: costCenters.id, updatedAt: costCenters.updatedAt })
      .from(costCenters)
      .where(and(inArray(costCenters.id, ids), eq(costCenters.companyId, companyId)));
    for (const r of rows) map.set(r.id, r.updatedAt);
    return map;
  },
};
