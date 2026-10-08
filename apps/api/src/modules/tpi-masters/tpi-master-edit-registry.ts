// TPI Inspector (TPI Master) entry for the edit-approval engine (ADR-202, Phase 2c).
//
// RECORD-level: a TPI Inspector is a single record with no child lines, so every
// editable field is a header field and there is no line guard. applyEdit replays
// the approved subset through updateTpiMasterTx, so the edit runs exactly as a
// direct edit.
//
// The edit screen's own `expectedUpdatedAt` (ADR-225) is checked twice before
// anything reaches here — when the edit is REQUESTED, and again inside
// updateTpiMasterTx — but it is deliberately NOT forwarded on this replay: the
// approver is applying someone else's older request, so the requester's token
// is not the approver's. loadForDiff's FOR UPDATE lock plus the engine's
// field-freshness recheck at approval are what guard this path.
//
// A master has no money column, so there is no price-gated field here — every
// field in TPI_MASTER_EDIT_FIELDS is visible to any editor.

import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { AccessFormKey, UpdateTpiMasterInput } from '@innovic/shared';
import { tpiMasters } from '../../db/schema';
import type { DiffField } from '../../lib/audit-trail';
import type { DocEditRegistryEntry, DocEditTarget } from '../document-edits/registry';
import { TPI_MASTER_EDIT_FIELDS, updateTpiMasterTx } from './service';

const TPI_MASTER_FORM_KEY: AccessFormKey = 'tpimaster_create';

export const tpiMasterEditRegistryEntry: DocEditRegistryEntry = {
  formKey: TPI_MASTER_FORM_KEY,

  diffFields(): readonly DiffField[] {
    return TPI_MASTER_EDIT_FIELDS;
  },

  async loadForDiff(tx, companyId, id): Promise<DocEditTarget | null> {
    const rows = await tx
      .select()
      .from(tpiMasters)
      .where(
        and(eq(tpiMasters.id, id), eq(tpiMasters.companyId, companyId), isNull(tpiMasters.deletedAt)),
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
      organization: d['organization'],
      contactNo: d['contactNo'],
      email: d['email'],
      remarks: d['remarks'],
      isActive: d['isActive'],
    };
  },

  afterSnapshot(_tx, _companyId, input) {
    const i = input as UpdateTpiMasterInput;
    const out: Record<string, unknown> = {};
    if (i.organization !== undefined) out['organization'] = i.organization ?? null;
    if (i.contactNo !== undefined) out['contactNo'] = i.contactNo ?? null;
    if (i.email !== undefined) out['email'] = i.email ?? null;
    if (i.remarks !== undefined) out['remarks'] = i.remarks ?? null;
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
    await updateTpiMasterTx(tx, id, filteredInput as UpdateTpiMasterInput, user);
  },

  async loadUpdatedAts(tx, companyId, ids) {
    const map = new Map<string, Date | string | null>();
    if (ids.length === 0) return map;
    const rows = await tx
      .select({ id: tpiMasters.id, updatedAt: tpiMasters.updatedAt })
      .from(tpiMasters)
      .where(and(inArray(tpiMasters.id, ids), eq(tpiMasters.companyId, companyId)));
    for (const r of rows) map.set(r.id, r.updatedAt);
    return map;
  },
};
