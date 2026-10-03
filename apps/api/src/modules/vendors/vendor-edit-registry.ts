// Vendor (Vendor Master) entry for the edit-approval engine (ADR-202, Phase 2c).
//
// RECORD-level: a vendor is a single record with no child lines, so every
// editable field is a header field and there is no line guard. applyEdit replays
// the approved subset through updateVendorTx, so every vendor guard (FOR UPDATE
// lock, assertUnchangedSinceOpened and the GST rule) runs exactly as a direct
// edit.
//
// A master has no money column, so there is no price-gated field here (unlike a
// PR's estimated cost) — every field in VENDOR_FIELDS is visible to any editor.

import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { AccessFormKey, UpdateVendorInput } from '@innovic/shared';
import { vendors } from '../../db/schema';
import type { DiffField } from '../../lib/audit-trail';
import type { DocEditRegistryEntry, DocEditTarget } from '../document-edits/registry';
import { updateVendorTx, VENDOR_FIELDS } from './service';

const VENDOR_FORM_KEY: AccessFormKey = 'vendor_create';

export const vendorEditRegistryEntry: DocEditRegistryEntry = {
  formKey: VENDOR_FORM_KEY,

  diffFields(): readonly DiffField[] {
    return VENDOR_FIELDS;
  },

  async loadForDiff(tx, companyId, id): Promise<DocEditTarget | null> {
    const rows = await tx
      .select()
      .from(vendors)
      .where(and(eq(vendors.id, id), eq(vendors.companyId, companyId), isNull(vendors.deletedAt)))
      .limit(1)
      .for('update');
    const vendor = rows[0];
    if (!vendor) return null;
    return {
      doc: { ...vendor },
      updatedAt: vendor.updatedAt,
      docCode: vendor.code,
      // A master is editable as long as it is not in Trash.
      isLive: true,
    };
  },

  beforeSnapshot(target) {
    const d = target.doc;
    return {
      name: d['name'],
      contactPerson: d['contactPerson'],
      phone: d['phone'],
      email: d['email'],
      gstNumber: d['gstNumber'],
      gstCategory: d['gstCategory'],
      addressLine1: d['addressLine1'],
      city: d['city'],
      state: d['state'],
      stateCode: d['stateCode'],
      pincode: d['pincode'],
      materialsSupplied: d['materialsSupplied'],
      rating: d['rating'],
      paymentTermsDays: d['paymentTermsDays'],
      isActive: d['isActive'],
    };
  },

  afterSnapshot(_tx, _companyId, input) {
    const i = input as UpdateVendorInput;
    const out: Record<string, unknown> = {};
    if (i.name !== undefined) out['name'] = i.name;
    if (i.contactPerson !== undefined) out['contactPerson'] = i.contactPerson ?? null;
    if (i.phone !== undefined) out['phone'] = i.phone ?? null;
    if (i.email !== undefined) out['email'] = i.email ?? null;
    if (i.gstNumber !== undefined) out['gstNumber'] = i.gstNumber ?? null;
    if (i.gstCategory !== undefined) out['gstCategory'] = i.gstCategory ?? null;
    if (i.addressLine1 !== undefined) out['addressLine1'] = i.addressLine1 ?? null;
    if (i.city !== undefined) out['city'] = i.city ?? null;
    if (i.state !== undefined) out['state'] = i.state ?? null;
    if (i.stateCode !== undefined) out['stateCode'] = i.stateCode ?? null;
    if (i.pincode !== undefined) out['pincode'] = i.pincode ?? null;
    if (i.materialsSupplied !== undefined) out['materialsSupplied'] = i.materialsSupplied ?? null;
    if (i.rating !== undefined) out['rating'] = i.rating ?? null;
    if (i.paymentTermsDays !== undefined) out['paymentTermsDays'] = i.paymentTermsDays ?? null;
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
    const filtered = filteredInput as UpdateVendorInput;
    await updateVendorTx(
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
      .select({ id: vendors.id, updatedAt: vendors.updatedAt })
      .from(vendors)
      .where(and(inArray(vendors.id, ids), eq(vendors.companyId, companyId)));
    for (const r of rows) map.set(r.id, r.updatedAt);
    return map;
  },
};
