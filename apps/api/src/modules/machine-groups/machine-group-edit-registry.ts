// MachineGroup (Machine Group master) entry for the edit-approval engine
// (ADR-202).
//
// RECORD-level: a machine group is a single record with no child lines, so every
// editable field is a header field and there is no line guard. applyEdit replays
// the approved subset through updateMachineGroupTx inside the engine's
// transaction, which already holds the group row locked FOR UPDATE — that lock,
// plus the engine's field-freshness check at approval, is the concurrency guard
// (this master carries no `expectedUpdatedAt` token).
//
// A group has no money column, so every field in MACHINE_GROUP_EDIT_FIELDS is
// visible to any editor. `code` is not editable, so it is not diffed.

import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { AccessFormKey, UpdateMachineGroupInput } from '@innovic/shared';
import { machineGroups } from '../../db/schema';
import type { DiffField } from '../../lib/audit-trail';
import type { DocEditRegistryEntry, DocEditTarget } from '../document-edits/registry';
import { MACHINE_GROUP_EDIT_FIELDS, updateMachineGroupTx } from './service';

// The Machine Groups tab shares the Production form key with ../machines.
const MACHINE_GROUP_FORM_KEY: AccessFormKey = 'machine_create';

export const machineGroupEditRegistryEntry: DocEditRegistryEntry = {
  formKey: MACHINE_GROUP_FORM_KEY,

  diffFields(): readonly DiffField[] {
    return MACHINE_GROUP_EDIT_FIELDS;
  },

  async loadForDiff(tx, companyId, id): Promise<DocEditTarget | null> {
    const rows = await tx
      .select()
      .from(machineGroups)
      .where(
        and(
          eq(machineGroups.id, id),
          eq(machineGroups.companyId, companyId),
          isNull(machineGroups.deletedAt),
        ),
      )
      .limit(1)
      .for('update');
    const group = rows[0];
    if (!group) return null;
    return {
      doc: { ...group },
      updatedAt: group.updatedAt,
      docCode: group.code,
      // A master is editable as long as it is not in Trash.
      isLive: true,
    };
  },

  beforeSnapshot(target) {
    const d = target.doc;
    return {
      description: d['description'],
      isActive: d['isActive'],
    };
  },

  afterSnapshot(_tx, _companyId, input) {
    const i = input as UpdateMachineGroupInput;
    const out: Record<string, unknown> = {};
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
    const filtered = filteredInput as UpdateMachineGroupInput;
    await updateMachineGroupTx(tx, id, filtered, user);
  },

  async loadUpdatedAts(tx, companyId, ids) {
    const map = new Map<string, Date | string | null>();
    if (ids.length === 0) return map;
    const rows = await tx
      .select({ id: machineGroups.id, updatedAt: machineGroups.updatedAt })
      .from(machineGroups)
      .where(and(inArray(machineGroups.id, ids), eq(machineGroups.companyId, companyId)));
    for (const r of rows) map.set(r.id, r.updatedAt);
    return map;
  },
};
