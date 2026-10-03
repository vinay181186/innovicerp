// Plan entry for the edit-approval engine (ADR-202, Phase 2a).
//
// RECORD-level only: this pass stages the plan's own fields (the set the module's
// EDIT diff emits). A plan's child operations are NOT staged — an ops change is
// refused by the divert guard in service.ts (planOpsChanged). applyEdit replays
// the approved subset through updatePlanTx, so every plan §20 guard (FOR UPDATE
// lock, assertUnchangedSinceOpened, coverage / below-covered caps, raw-material-
// retyped-while-live guard, over-plan qty cap) runs exactly as a direct edit.

import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { AccessFormKey, UpdatePlanInput } from '@innovic/shared';
import { items, plans } from '../../db/schema';
import type { DbTransaction } from '../../db/with-user-context';
import type { DiffField } from '../../lib/audit-trail';
import type { DocEditRegistryEntry, DocEditTarget } from '../document-edits/registry';
import { EDITABLE_STATUSES, planEditFields, updatePlanTx } from './service';

const PLAN_FORM_KEY: AccessFormKey = 'plan_create';

/** The master code of a raw-material item, company-scoped. The snapshot stores
 *  this CODE under the `rawMaterialItemId` key so both sides of the diff read a
 *  code — planEditFields' own format then falls back to it (empty id→code map). */
async function itemCodeOf(
  tx: DbTransaction,
  companyId: string,
  itemId: string | null | undefined,
): Promise<string | null> {
  if (!itemId) return null;
  const rows = await tx
    .select({ code: items.code })
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.companyId, companyId)))
    .limit(1);
  return rows[0]?.code ?? null;
}

export const planEditRegistryEntry: DocEditRegistryEntry = {
  formKey: PLAN_FORM_KEY,

  diffFields(): readonly DiffField[] {
    // Snapshots store the RM item CODE under `rawMaterialItemId`, so an empty
    // id→code map is correct: the field's format falls back to that code.
    return planEditFields(new Map());
  },

  async loadForDiff(tx, companyId, id): Promise<DocEditTarget | null> {
    const rows = await tx
      .select()
      .from(plans)
      .where(and(eq(plans.id, id), eq(plans.companyId, companyId), isNull(plans.deletedAt)))
      .limit(1)
      .for('update');
    const plan = rows[0];
    if (!plan) return null;
    const rawMaterialItemCode = await itemCodeOf(tx, companyId, plan.rawMaterialItemId);
    return {
      doc: { ...plan, rawMaterialItemCode },
      updatedAt: plan.updatedAt,
      docCode: plan.code,
      // Editable while In Planning or Planned — the module's own rule.
      isLive: EDITABLE_STATUSES.includes(plan.planStatus),
    };
  },

  beforeSnapshot(target) {
    const d = target.doc;
    return {
      planDate: d['planDate'],
      planType: d['planType'],
      orderQty: d['orderQty'],
      planQty: d['planQty'],
      plannedStartDate: d['plannedStartDate'],
      plannedEndDate: d['plannedEndDate'],
      customerDispatchDate: d['customerDispatchDate'],
      rawMaterialGradeText: d['rawMaterialGradeText'],
      rawMaterialSizeText: d['rawMaterialSizeText'],
      rawMaterialItemId: d['rawMaterialItemCode'] ?? null,
      rmQtyPerPiece: d['rmQtyPerPiece'],
      dpVendorCodeText: d['dpVendorCodeText'],
      dpRemarks: d['dpRemarks'],
      foVendorCodeText: d['foVendorCodeText'],
      foProcess: d['foProcess'],
      foMaterialSrc: d['foMaterialSrc'],
      foDeliveryDate: d['foDeliveryDate'],
      foCostCenter: d['foCostCenter'],
      foRemarks: d['foRemarks'],
      requiredDocs: d['requiredDocs'],
      remarks: d['remarks'],
    };
  },

  async afterSnapshot(tx, companyId, input) {
    const i = input as UpdatePlanInput;
    const out: Record<string, unknown> = {};
    if (i.planDate !== undefined) out['planDate'] = i.planDate;
    if (i.planType !== undefined) out['planType'] = i.planType;
    if (i.orderQty !== undefined) out['orderQty'] = i.orderQty;
    if (i.planQty !== undefined) out['planQty'] = i.planQty;
    if (i.plannedStartDate !== undefined) out['plannedStartDate'] = i.plannedStartDate ?? null;
    if (i.plannedEndDate !== undefined) out['plannedEndDate'] = i.plannedEndDate ?? null;
    if (i.customerDispatchDate !== undefined)
      out['customerDispatchDate'] = i.customerDispatchDate ?? null;
    if (i.rawMaterialGradeText !== undefined)
      out['rawMaterialGradeText'] = i.rawMaterialGradeText ?? null;
    if (i.rawMaterialSizeText !== undefined)
      out['rawMaterialSizeText'] = i.rawMaterialSizeText ?? null;
    if (i.rawMaterialItemId !== undefined)
      out['rawMaterialItemId'] = await itemCodeOf(tx, companyId, i.rawMaterialItemId ?? null);
    if (i.rmQtyPerPiece !== undefined) out['rmQtyPerPiece'] = i.rmQtyPerPiece ?? null;
    if (i.dpVendorCodeText !== undefined) out['dpVendorCodeText'] = i.dpVendorCodeText ?? null;
    if (i.dpRemarks !== undefined) out['dpRemarks'] = i.dpRemarks ?? null;
    if (i.foVendorCodeText !== undefined) out['foVendorCodeText'] = i.foVendorCodeText ?? null;
    if (i.foProcess !== undefined) out['foProcess'] = i.foProcess ?? null;
    if (i.foMaterialSrc !== undefined) out['foMaterialSrc'] = i.foMaterialSrc ?? null;
    if (i.foDeliveryDate !== undefined) out['foDeliveryDate'] = i.foDeliveryDate ?? null;
    if (i.foCostCenter !== undefined) out['foCostCenter'] = i.foCostCenter ?? null;
    if (i.foRemarks !== undefined) out['foRemarks'] = i.foRemarks ?? null;
    if (i.requiredDocs !== undefined) out['requiredDocs'] = i.requiredDocs ?? null;
    if (i.remarks !== undefined) out['remarks'] = i.remarks ?? null;
    return out;
  },

  buildFilteredInput(proposedPayload, approvedFields) {
    const rec = proposedPayload as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    const copy = (k: string): void => {
      if (rec[k] !== undefined) out[k] = rec[k];
    };
    for (const field of approvedFields) {
      switch (field) {
        case 'rawMaterialGradeText':
          // Grade travels as id + text together.
          copy('rawMaterialGradeText');
          copy('rawMaterialGradeId');
          break;
        case 'rawMaterialSizeText':
          copy('rawMaterialSizeText');
          copy('rawMaterialSizeId');
          break;
        default:
          copy(field);
      }
    }
    if (Object.keys(out).length === 0) return null;
    return out;
  },

  async applyEdit(tx, _companyId, id, filteredInput, expectedUpdatedAt, user) {
    const filtered = filteredInput as UpdatePlanInput;
    await updatePlanTx(
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
      .select({ id: plans.id, updatedAt: plans.updatedAt })
      .from(plans)
      .where(and(inArray(plans.id, ids), eq(plans.companyId, companyId)));
    for (const r of rows) map.set(r.id, r.updatedAt);
    return map;
  },
};
