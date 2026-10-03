// PurchaseRequest entry for the edit-approval engine (ADR-202, Phase 2a).
//
// RECORD-level only: a PR carries a single item on its own record (no child
// lines), so every editable field is a header field and there is no line guard.
// applyEdit replays the approved subset through updatePurchaseRequestTx, so every
// PR §20 guard (FOR UPDATE lock, assertUnchangedSinceOpened, locked-if-on-a-live-
// PO, FK re-validation) runs exactly as a direct edit.

import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { AccessFormKey, UpdatePurchaseRequestInput } from '@innovic/shared';
import { purchaseRequests } from '../../db/schema';
import type { DbTransaction } from '../../db/with-user-context';
import { canSeeFormPrice } from '../../lib/access';
import type { DiffField } from '../../lib/audit-trail';
import type { DocEditRegistryEntry, DocEditTarget } from '../document-edits/registry';
import {
  PR_EDIT_FIELDS,
  loadOrderedQty,
  loadVendorCodes,
  updatePurchaseRequestTx,
} from './service';

const PR_FORM_KEY: AccessFormKey = 'pr_create';

/** The vendor as a person reads it: the master code when a vendor is linked,
 *  else the free-text snapshot (matches the module's own EDIT diff). */
async function vendorCodeOf(
  tx: DbTransaction,
  companyId: string,
  vendorId: string | null | undefined,
  fallback: string | null | undefined,
): Promise<string | null> {
  if (!vendorId) return fallback ?? null;
  const map = await loadVendorCodes(tx, companyId, [vendorId]);
  return map.get(vendorId) ?? fallback ?? null;
}

export const prEditRegistryEntry: DocEditRegistryEntry = {
  formKey: PR_FORM_KEY,

  diffFields(): readonly DiffField[] {
    return PR_EDIT_FIELDS;
  },

  async loadForDiff(tx, companyId, id): Promise<DocEditTarget | null> {
    const rows = await tx
      .select()
      .from(purchaseRequests)
      .where(
        and(
          eq(purchaseRequests.id, id),
          eq(purchaseRequests.companyId, companyId),
          isNull(purchaseRequests.deletedAt),
        ),
      )
      .limit(1)
      .for('update');
    const pr = rows[0];
    if (!pr) return null;
    const vendor = await vendorCodeOf(tx, companyId, pr.vendorId, pr.vendorCodeText);
    const orderedQty = await loadOrderedQty(tx, pr);
    return {
      doc: { ...pr, vendor },
      updatedAt: pr.updatedAt,
      docCode: pr.code,
      // Editable while nothing is on a live PO — the module's own edit rule.
      isLive: orderedQty === 0,
    };
  },

  beforeSnapshot(target) {
    const d = target.doc;
    return {
      prDate: d['prDate'],
      vendor: d['vendor'] ?? null,
      itemCodeText: d['itemCodeText'],
      itemName: d['itemName'],
      qty: d['qty'],
      estCost: d['estCost'],
      requiredDate: d['requiredDate'],
      operation: d['operation'],
      remarks: d['remarks'],
    };
  },

  async afterSnapshot(tx, companyId, input, user) {
    const i = input as UpdatePurchaseRequestInput;
    const out: Record<string, unknown> = {};
    if (i.prDate !== undefined) out['prDate'] = i.prDate;
    if (i.itemCodeText !== undefined) out['itemCodeText'] = i.itemCodeText ?? null;
    if (i.itemName !== undefined) out['itemName'] = i.itemName ?? null;
    if (i.qty !== undefined) out['qty'] = i.qty;
    if (i.requiredDate !== undefined) out['requiredDate'] = i.requiredDate ?? null;
    if (i.operation !== undefined) out['operation'] = i.operation ?? null;
    if (i.remarks !== undefined) out['remarks'] = i.remarks ?? null;
    if (i.vendorId !== undefined || i.vendorCodeText !== undefined) {
      out['vendor'] = await vendorCodeOf(tx, companyId, i.vendorId ?? null, i.vendorCodeText ?? null);
    }
    // Money field only when the actor may see prices — a price-blind payload
    // carries a zod default that would otherwise read as an Est. Rate change.
    if (i.estCost !== undefined && (await canSeeFormPrice(user, PR_FORM_KEY))) {
      out['estCost'] = i.estCost;
    }
    return out;
  },

  buildFilteredInput(proposedPayload, approvedFields) {
    const input = proposedPayload as UpdatePurchaseRequestInput;
    const rec = input as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    const copy = (k: string): void => {
      if (rec[k] !== undefined) out[k] = rec[k];
    };
    for (const field of approvedFields) {
      switch (field) {
        case 'vendor':
          // One screen fact spanning two columns — carry both halves.
          copy('vendorId');
          copy('vendorCodeText');
          break;
        case 'itemCodeText':
          // The item identity travels as id + code together.
          copy('itemCodeText');
          copy('itemId');
          break;
        default:
          copy(field);
      }
    }
    if (Object.keys(out).length === 0) return null;
    return out;
  },

  async applyEdit(tx, _companyId, id, filteredInput, expectedUpdatedAt, user) {
    const filtered = filteredInput as UpdatePurchaseRequestInput;
    await updatePurchaseRequestTx(
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
      .select({ id: purchaseRequests.id, updatedAt: purchaseRequests.updatedAt })
      .from(purchaseRequests)
      .where(and(inArray(purchaseRequests.id, ids), eq(purchaseRequests.companyId, companyId)));
    for (const r of rows) map.set(r.id, r.updatedAt);
    return map;
  },
};
