// ProductionOrder entry for the edit-approval engine (ADR-202, Phase 3).
//
// HEADER-level only: a Production Order's quantity is reduced with Short Close,
// never edited (order_qty drives the plan SUM-cap, the Job Card qty snapshot,
// reservations and the credited / close math), and its identity / status /
// close fields never change. The only editable header fields are Remarks, PRO
// Target Date, Actual Size and Raw Material Available. applyEdit replays the
// approved subset through updateProductionOrderTx, so every §20 guard (FOR
// UPDATE lock, assertUnchangedSinceOpened, conditional status write, order_qty
// refusal) runs exactly as a direct edit.

import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { AccessFormKey, ProductionOrderStatus } from '@innovic/shared';
import { productionOrders } from '../../db/schema';
import type { DiffField } from '../../lib/audit-trail';
import type { DocEditRegistryEntry, DocEditTarget } from '../document-edits/registry';
import type { UpdateProductionOrderInput } from './schema';
import {
  PRODUCTION_ORDER_EDITABLE_STATUSES,
  PRODUCTION_ORDER_EDIT_FIELDS,
  updateProductionOrderTx,
} from './service';

const PO_FORM_KEY: AccessFormKey = 'prodorder_create';

export const productionOrderEditRegistryEntry: DocEditRegistryEntry = {
  formKey: PO_FORM_KEY,

  diffFields(): readonly DiffField[] {
    return PRODUCTION_ORDER_EDIT_FIELDS;
  },

  async loadForDiff(tx, companyId, id): Promise<DocEditTarget | null> {
    const rows = await tx
      .select()
      .from(productionOrders)
      .where(
        and(
          eq(productionOrders.id, id),
          eq(productionOrders.companyId, companyId),
          isNull(productionOrders.deletedAt),
        ),
      )
      .limit(1)
      .for('update');
    const po = rows[0];
    if (!po) return null;
    return {
      doc: po,
      updatedAt: po.updatedAt,
      docCode: po.code,
      // Editable while still being made — open or partly closed. A closed /
      // short-closed order is frozen.
      isLive: PRODUCTION_ORDER_EDITABLE_STATUSES.includes(po.status as ProductionOrderStatus),
    };
  },

  beforeSnapshot(target) {
    const d = target.doc;
    return {
      remarks: d['remarks'],
      targetDate: d['targetDate'],
      actualSize: d['actualSize'],
      rawMaterialAvailable: d['rawMaterialAvailable'],
    };
  },

  afterSnapshot(_tx, _companyId, input) {
    const i = input as UpdateProductionOrderInput;
    const out: Record<string, unknown> = {};
    if (i.remarks !== undefined) out['remarks'] = i.remarks ?? null;
    if (i.targetDate !== undefined) out['targetDate'] = i.targetDate;
    if (i.actualSize !== undefined)
      out['actualSize'] = i.actualSize?.trim() ? i.actualSize.trim() : null;
    if (i.rawMaterialAvailable !== undefined) out['rawMaterialAvailable'] = i.rawMaterialAvailable;
    return Promise.resolve(out);
  },

  buildFilteredInput(proposedPayload, approvedFields) {
    const rec = proposedPayload as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    // Each editable field is a single screen fact on a single column, so no
    // split-fact fan-out is needed (unlike PR vendor / Plan raw material).
    for (const field of approvedFields) {
      if (rec[field] !== undefined) out[field] = rec[field];
    }
    if (Object.keys(out).length === 0) return null;
    return out;
  },

  async applyEdit(tx, _companyId, id, filteredInput, expectedUpdatedAt, user) {
    const filtered = filteredInput as UpdateProductionOrderInput;
    await updateProductionOrderTx(
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
      .select({ id: productionOrders.id, updatedAt: productionOrders.updatedAt })
      .from(productionOrders)
      .where(and(inArray(productionOrders.id, ids), eq(productionOrders.companyId, companyId)));
    for (const r of rows) map.set(r.id, r.updatedAt);
    return map;
  },
};
