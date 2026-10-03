// Item (Item Master) entry for the edit-approval engine (ADR-202, Phase 2c).
//
// RECORD-level: an item is a single record with no child lines, so every
// editable field is a header field and there is no line guard. applyEdit replays
// the approved subset through updateItemTx, so every item guard (FOR UPDATE lock,
// assertUnchangedSinceOpened, the type-lock / party-suffix guards and the HSN
// rule) runs exactly as a direct edit.
//
// A master has no money column, so there is no price-gated field here (unlike a
// PR's estimated cost) — every field in ITEM_FIELDS is visible to any editor.

import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { AccessFormKey, UpdateItemInput } from '@innovic/shared';
import { items } from '../../db/schema';
import type { DiffField } from '../../lib/audit-trail';
import type { DocEditRegistryEntry, DocEditTarget } from '../document-edits/registry';
import { ITEM_FIELDS, updateItemTx } from './service';

const ITEM_FORM_KEY: AccessFormKey = 'item_create';

export const itemEditRegistryEntry: DocEditRegistryEntry = {
  formKey: ITEM_FORM_KEY,

  diffFields(): readonly DiffField[] {
    return ITEM_FIELDS;
  },

  async loadForDiff(tx, companyId, id): Promise<DocEditTarget | null> {
    const rows = await tx
      .select()
      .from(items)
      .where(and(eq(items.id, id), eq(items.companyId, companyId), isNull(items.deletedAt)))
      .limit(1)
      .for('update');
    const item = rows[0];
    if (!item) return null;
    return {
      doc: { ...item },
      updatedAt: item.updatedAt,
      docCode: item.code,
      // A master is editable as long as it is not in Trash — there is no
      // "locked by a downstream document" state for the Item Master itself.
      isLive: true,
    };
  },

  beforeSnapshot(target) {
    const d = target.doc;
    return {
      name: d['name'],
      description: d['description'],
      drawingNo: d['drawingNo'],
      revision: d['revision'],
      material: d['material'],
      uom: d['uom'],
      itemType: d['itemType'],
      procurementType: d['procurementType'],
      trackSerial: d['trackSerial'],
      hsnCode: d['hsnCode'],
      drawingFilePath: d['drawingFilePath'],
      imagePath: d['imagePath'],
    };
  },

  afterSnapshot(_tx, _companyId, input) {
    const i = input as UpdateItemInput;
    const out: Record<string, unknown> = {};
    if (i.name !== undefined) out['name'] = i.name;
    if (i.description !== undefined) out['description'] = i.description ?? null;
    if (i.drawingNo !== undefined) out['drawingNo'] = i.drawingNo ?? null;
    if (i.revision !== undefined) out['revision'] = i.revision;
    if (i.material !== undefined) out['material'] = i.material ?? null;
    if (i.uom !== undefined) out['uom'] = i.uom;
    if (i.itemType !== undefined) out['itemType'] = i.itemType;
    if (i.procurementType !== undefined) out['procurementType'] = i.procurementType;
    if (i.trackSerial !== undefined) out['trackSerial'] = i.trackSerial;
    if (i.hsnCode !== undefined) out['hsnCode'] = i.hsnCode ?? null;
    if (i.drawingFilePath !== undefined) out['drawingFilePath'] = i.drawingFilePath ?? null;
    if (i.imagePath !== undefined) out['imagePath'] = i.imagePath ?? null;
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
    const filtered = filteredInput as UpdateItemInput;
    await updateItemTx(
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
      .select({ id: items.id, updatedAt: items.updatedAt })
      .from(items)
      .where(and(inArray(items.id, ids), eq(items.companyId, companyId)));
    for (const r of rows) map.set(r.id, r.updatedAt);
    return map;
  },
};
