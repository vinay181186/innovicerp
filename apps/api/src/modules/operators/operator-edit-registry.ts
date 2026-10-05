// Operator (Operator Master) entry for the edit-approval engine (ADR-202).
//
// RECORD-level: an operator is a single record with no child lines, so every
// editable field is a header field and there is no line guard. applyEdit replays
// the approved subset through updateOperatorTx inside the engine's transaction,
// which already holds the operator row locked FOR UPDATE — that lock, plus the
// engine's field-freshness check at approval, is the concurrency guard (this
// master carries no `expectedUpdatedAt` token).
//
// A master has no money column, so every field in OPERATOR_FIELDS is visible to
// any editor.

import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { AccessFormKey, UpdateOperatorInput } from '@innovic/shared';
import { operators } from '../../db/schema';
import type { DiffField } from '../../lib/audit-trail';
import type { DocEditRegistryEntry, DocEditTarget } from '../document-edits/registry';
import { OPERATOR_FIELDS, updateOperatorTx } from './service';

const OPERATOR_FORM_KEY: AccessFormKey = 'operator_create';

export const operatorEditRegistryEntry: DocEditRegistryEntry = {
  formKey: OPERATOR_FORM_KEY,

  diffFields(): readonly DiffField[] {
    return OPERATOR_FIELDS;
  },

  async loadForDiff(tx, companyId, id): Promise<DocEditTarget | null> {
    const rows = await tx
      .select()
      .from(operators)
      .where(
        and(eq(operators.id, id), eq(operators.companyId, companyId), isNull(operators.deletedAt)),
      )
      .limit(1)
      .for('update');
    const operator = rows[0];
    if (!operator) return null;
    return {
      doc: { ...operator },
      updatedAt: operator.updatedAt,
      docCode: operator.code,
      // A master is editable as long as it is not in Trash.
      isLive: true,
    };
  },

  beforeSnapshot(target) {
    const d = target.doc;
    return {
      name: d['name'],
      department: d['department'],
      skills: d['skills'],
      isActive: d['isActive'],
      userId: d['userId'],
    };
  },

  afterSnapshot(_tx, _companyId, input) {
    const i = input as UpdateOperatorInput;
    const out: Record<string, unknown> = {};
    if (i.name !== undefined) out['name'] = i.name;
    if (i.department !== undefined) out['department'] = i.department ?? null;
    if (i.skills !== undefined) out['skills'] = i.skills ?? null;
    if (i.isActive !== undefined) out['isActive'] = i.isActive;
    if (i.userId !== undefined) out['userId'] = i.userId && i.userId.length > 0 ? i.userId : null;
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
    const filtered = filteredInput as UpdateOperatorInput;
    await updateOperatorTx(tx, id, filtered, user);
  },

  async loadUpdatedAts(tx, companyId, ids) {
    const map = new Map<string, Date | string | null>();
    if (ids.length === 0) return map;
    const rows = await tx
      .select({ id: operators.id, updatedAt: operators.updatedAt })
      .from(operators)
      .where(and(inArray(operators.id, ids), eq(operators.companyId, companyId)));
    for (const r of rows) map.set(r.id, r.updatedAt);
    return map;
  },
};
