// Machine (Machine Master) entry for the edit-approval engine (ADR-202).
//
// RECORD-level: a machine is a single record with no child lines, so every
// editable field is a header field and there is no line guard. applyEdit replays
// the approved subset through updateMachineTx inside the engine's transaction,
// which already holds the machine row locked FOR UPDATE — that lock, plus the
// engine's field-freshness check at approval, is the concurrency guard (this
// master carries no `expectedUpdatedAt` token).
//
// The only money on a machine is its ₹/hr rate, so afterSnapshot proposes
// `hourRate` only when the actor may see prices (canSeeFormPrice) — mirroring
// the module's own money-in rule in updateMachineTx.

import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { AccessFormKey, UpdateMachineInput } from '@innovic/shared';
import { machines } from '../../db/schema';
import { canSeeFormPrice } from '../../lib/access';
import type { DiffField } from '../../lib/audit-trail';
import type { DocEditRegistryEntry, DocEditTarget } from '../document-edits/registry';
import { MACHINE_EDIT_FIELDS, updateMachineTx } from './service';

const MACHINE_FORM_KEY: AccessFormKey = 'machine_create';

export const machineEditRegistryEntry: DocEditRegistryEntry = {
  formKey: MACHINE_FORM_KEY,

  diffFields(): readonly DiffField[] {
    return MACHINE_EDIT_FIELDS;
  },

  async loadForDiff(tx, companyId, id): Promise<DocEditTarget | null> {
    const rows = await tx
      .select()
      .from(machines)
      .where(and(eq(machines.id, id), eq(machines.companyId, companyId), isNull(machines.deletedAt)))
      .limit(1)
      .for('update');
    const machine = rows[0];
    if (!machine) return null;
    return {
      doc: { ...machine },
      updatedAt: machine.updatedAt,
      docCode: machine.code,
      // A master is editable as long as it is not in Trash.
      isLive: true,
    };
  },

  beforeSnapshot(target) {
    const d = target.doc;
    return {
      name: d['name'],
      machineType: d['machineType'],
      machineGroupId: d['machineGroupId'],
      productCode: d['productCode'],
      capacityPerShift: d['capacityPerShift'],
      shiftsPerDay: d['shiftsPerDay'],
      status: d['status'],
      hourRate: d['hourRate'],
    };
  },

  async afterSnapshot(_tx, _companyId, input, user) {
    const i = input as UpdateMachineInput;
    const out: Record<string, unknown> = {};
    if (i.name !== undefined) out['name'] = i.name;
    if (i.machineType !== undefined) out['machineType'] = i.machineType ?? null;
    if (i.machineGroupId !== undefined) out['machineGroupId'] = i.machineGroupId ?? null;
    if (i.productCode !== undefined) out['productCode'] = i.productCode ?? null;
    if (i.capacityPerShift !== undefined) out['capacityPerShift'] = i.capacityPerShift ?? null;
    if (i.shiftsPerDay !== undefined) out['shiftsPerDay'] = i.shiftsPerDay;
    if (i.status !== undefined) out['status'] = i.status;
    // Money field only when the actor may see prices — a price-blind payload
    // echoes back a rate the user was never shown, which must not read as a change.
    if (i.hourRate !== undefined && (await canSeeFormPrice(user, MACHINE_FORM_KEY))) {
      out['hourRate'] = i.hourRate;
    }
    return out;
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
    const filtered = filteredInput as UpdateMachineInput;
    await updateMachineTx(tx, id, filtered, user);
  },

  async loadUpdatedAts(tx, companyId, ids) {
    const map = new Map<string, Date | string | null>();
    if (ids.length === 0) return map;
    const rows = await tx
      .select({ id: machines.id, updatedAt: machines.updatedAt })
      .from(machines)
      .where(and(inArray(machines.id, ids), eq(machines.companyId, companyId)));
    for (const r of rows) map.set(r.id, r.updatedAt);
    return map;
  },
};
