// Client (Customer Master) entry for the edit-approval engine (ADR-202, Phase 2c).
//
// RECORD-level: a customer is a single record with no child lines, so every
// editable field is a header field and there is no line guard. applyEdit replays
// the approved subset through updateClientTx, so every customer guard (FOR UPDATE
// lock, assertUnchangedSinceOpened, the one-name-per-customer check and the GST
// rule) runs exactly as a direct edit.
//
// A master has no money column, so there is no price-gated field here (unlike a
// PR's estimated cost) — every field in CLIENT_FIELDS is visible to any editor.

import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { AccessFormKey, UpdateClientInput } from '@innovic/shared';
import { clients } from '../../db/schema';
import type { DiffField } from '../../lib/audit-trail';
import type { DocEditRegistryEntry, DocEditTarget } from '../document-edits/registry';
import { CLIENT_FIELDS, updateClientTx } from './service';

const CLIENT_FORM_KEY: AccessFormKey = 'client_create';

export const clientEditRegistryEntry: DocEditRegistryEntry = {
  formKey: CLIENT_FORM_KEY,

  diffFields(): readonly DiffField[] {
    return CLIENT_FIELDS;
  },

  async loadForDiff(tx, companyId, id): Promise<DocEditTarget | null> {
    const rows = await tx
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.companyId, companyId), isNull(clients.deletedAt)))
      .limit(1)
      .for('update');
    const client = rows[0];
    if (!client) return null;
    return {
      doc: { ...client },
      updatedAt: client.updatedAt,
      docCode: client.code,
      // A master is editable as long as it is not in Trash.
      isLive: true,
    };
  },

  beforeSnapshot(target) {
    const d = target.doc;
    return {
      name: d['name'],
      gstNumber: d['gstNumber'],
      gstCategory: d['gstCategory'],
      addressLine1: d['addressLine1'],
      city: d['city'],
      state: d['state'],
      stateCode: d['stateCode'],
      pincode: d['pincode'],
      contactPerson: d['contactPerson'],
      phone: d['phone'],
      email: d['email'],
      paymentDays: d['paymentDays'],
      isActive: d['isActive'],
    };
  },

  afterSnapshot(_tx, _companyId, input) {
    const i = input as UpdateClientInput;
    const out: Record<string, unknown> = {};
    if (i.name !== undefined) out['name'] = i.name;
    if (i.gstNumber !== undefined) out['gstNumber'] = i.gstNumber ?? null;
    if (i.gstCategory !== undefined) out['gstCategory'] = i.gstCategory ?? null;
    if (i.addressLine1 !== undefined) out['addressLine1'] = i.addressLine1 ?? null;
    if (i.city !== undefined) out['city'] = i.city ?? null;
    if (i.state !== undefined) out['state'] = i.state ?? null;
    if (i.stateCode !== undefined) out['stateCode'] = i.stateCode ?? null;
    if (i.pincode !== undefined) out['pincode'] = i.pincode ?? null;
    if (i.contactPerson !== undefined) out['contactPerson'] = i.contactPerson ?? null;
    if (i.phone !== undefined) out['phone'] = i.phone ?? null;
    if (i.email !== undefined) out['email'] = i.email ?? null;
    if (i.paymentDays !== undefined) out['paymentDays'] = i.paymentDays ?? null;
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

  async applyEdit(tx, _companyId, id, filteredInput, expectedUpdatedAt, user) {
    const filtered = filteredInput as UpdateClientInput;
    await updateClientTx(
      tx,
      id,
      { ...filtered, expectedUpdatedAt: expectedUpdatedAt ?? undefined },
      user,
    );
  },

  async loadUpdatedAts(tx, companyId, ids) {
    const map = new Map<string, Date | string | null>();
    if (ids.length === 0) return map;
    const rows = await tx
      .select({ id: clients.id, updatedAt: clients.updatedAt })
      .from(clients)
      .where(and(inArray(clients.id, ids), eq(clients.companyId, companyId)));
    for (const r of rows) map.set(r.id, r.updatedAt);
    return map;
  },
};
