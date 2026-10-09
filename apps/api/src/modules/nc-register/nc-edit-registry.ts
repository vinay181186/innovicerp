// NonConformance entry for the edit-approval engine (ADR-202, Phase 2a).
//
// RECORD-level only: an NC is a single record with no child lines, so there is
// no line guard. applyEdit replays the approved subset through updateNcRegisterTx,
// so every NC §20 guard (lockNcRow, the status-conditional `UPDATE … WHERE
// status='pending'` and its 0-row check) runs exactly as a direct edit.
//
// The edit screen's `expectedUpdatedAt` (ADR-226) is checked twice before
// anything reaches here — when the edit is REQUESTED, and again inside
// updateNcRegisterTx — but it is deliberately NOT forwarded on this replay:
// the approver is applying someone else's older request, so the requester's
// token is not the approver's.

import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { AccessFormKey, UpdateNcRegisterInput } from '@innovic/shared';
import { ncRegister } from '../../db/schema';
import type { DiffField } from '../../lib/audit-trail';
import type { DocEditRegistryEntry, DocEditTarget } from '../document-edits/registry';
import { NC_EDIT_FIELDS, updateNcRegisterTx } from './service';

const NC_FORM_KEY: AccessFormKey = 'nc_dispose';

const NC_RECORD_FIELDS = [
  'ncDate',
  'reasonCategory',
  'reason',
  'reportedByText',
  'operatorText',
] as const;

export const ncEditRegistryEntry: DocEditRegistryEntry = {
  formKey: NC_FORM_KEY,

  diffFields(): readonly DiffField[] {
    return NC_EDIT_FIELDS;
  },

  async loadForDiff(tx, companyId, id): Promise<DocEditTarget | null> {
    const rows = await tx
      .select()
      .from(ncRegister)
      .where(
        and(
          eq(ncRegister.id, id),
          eq(ncRegister.companyId, companyId),
          isNull(ncRegister.deletedAt),
        ),
      )
      .limit(1)
      .for('update');
    const nc = rows[0];
    if (!nc) return null;
    return {
      doc: { ...nc },
      updatedAt: nc.updatedAt,
      docCode: nc.code,
      // Only an 'NC Raised' (pending) NC is editable — the module's own rule.
      isLive: nc.status === 'pending',
    };
  },

  beforeSnapshot(target) {
    const d = target.doc;
    return {
      ncDate: d['ncDate'],
      reasonCategory: d['reasonCategory'],
      reason: d['reason'],
      reportedByText: d['reportedByText'],
      operatorText: d['operatorText'],
    };
  },

  async afterSnapshot(_tx, _companyId, input) {
    const i = input as UpdateNcRegisterInput;
    const out: Record<string, unknown> = {};
    if (i.ncDate !== undefined) out['ncDate'] = i.ncDate;
    if (i.reasonCategory !== undefined) out['reasonCategory'] = i.reasonCategory;
    if (i.reason !== undefined) out['reason'] = i.reason ?? null;
    if (i.reportedByText !== undefined) out['reportedByText'] = i.reportedByText ?? null;
    if (i.operatorText !== undefined) out['operatorText'] = i.operatorText ?? null;
    return out;
  },

  buildFilteredInput(proposedPayload, approvedFields) {
    const rec = proposedPayload as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const field of NC_RECORD_FIELDS) {
      if (approvedFields.has(field) && rec[field] !== undefined) out[field] = rec[field];
    }
    if (Object.keys(out).length === 0) return null;
    return out;
  },

  async applyEdit(tx, _companyId, id, filteredInput, _expectedUpdatedAt, user) {
    // The requester's token is not forwarded (see the file header): on this
    // replay the status-conditional UPDATE under lockNcRow plus the engine's
    // field-freshness recheck at approval are the guard.
    await updateNcRegisterTx(tx, id, filteredInput as UpdateNcRegisterInput, user);
  },

  async loadUpdatedAts(tx, companyId, ids) {
    const map = new Map<string, Date | string | null>();
    if (ids.length === 0) return map;
    const rows = await tx
      .select({ id: ncRegister.id, updatedAt: ncRegister.updatedAt })
      .from(ncRegister)
      .where(and(inArray(ncRegister.id, ids), eq(ncRegister.companyId, companyId)));
    for (const r of rows) map.set(r.id, r.updatedAt);
    return map;
  },
};
