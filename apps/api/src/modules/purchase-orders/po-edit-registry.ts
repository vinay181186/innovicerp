// PurchaseOrder entry for the edit-approval engine (ADR-202, Phase 1).
//
// Covers HEADER + tax + vendor changes. Line-level (item / qty / rate) diffing
// is deferred — see TODO(edit-approval phase 1b) below. applyEdit replays the
// approved edit through updatePurchaseOrderTx, so every PO §20 guard (money-lock,
// revision bump, line merge, optimistic lock) runs exactly as a direct edit.

import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { AccessFormKey, UpdatePurchaseOrderInput } from '@innovic/shared';
import { purchaseOrders, vendors } from '../../db/schema';
import type { DbTransaction } from '../../db/with-user-context';
import { canSeeFormPrice } from '../../lib/access';
import type { DiffField } from '../../lib/audit-trail';
import type { DocEditRegistryEntry, DocEditTarget } from '../document-edits/registry';
import { updatePurchaseOrderTx } from './service';

const PO_FORM_KEY: AccessFormKey = 'po_create';

const PO_TYPE_LABEL: Record<string, string> = {
  standard: 'Standard',
  job_work: 'Job Work',
  outsource: 'Outsource',
  service: 'Service',
};

// Header fields only this phase.
// TODO(edit-approval phase 1b): line-level changes (item / qty / rate per PO
// line). Phase 1 stages and approves header + tax + vendor changes only.
const PO_EDIT_DIFF_FIELDS: readonly DiffField[] = [
  { key: 'poDate', label: 'PO Date' },
  { key: 'vendorId', label: 'Vendor' },
  {
    key: 'poType',
    label: 'PO Type',
    format: (v) => (v == null ? null : (PO_TYPE_LABEL[String(v)] ?? String(v))),
  },
  { key: 'dueDate', label: 'Due Date' },
  { key: 'taxType', label: 'Tax Type' },
  { key: 'prCodeText', label: 'PR No.' },
  { key: 'remarks', label: 'Remarks' },
  { key: 'sgstPct', label: 'SGST %' },
  { key: 'cgstPct', label: 'CGST %' },
  { key: 'igstPct', label: 'IGST %' },
];

async function resolveVendorCode(
  tx: DbTransaction,
  companyId: string,
  vendorId: string | null,
): Promise<string | null> {
  if (!vendorId) return null;
  const rows = await tx
    .select({ code: vendors.code })
    .from(vendors)
    .where(and(eq(vendors.id, vendorId), eq(vendors.companyId, companyId)))
    .limit(1);
  return rows[0]?.code ?? null;
}

export const poEditRegistryEntry: DocEditRegistryEntry = {
  formKey: PO_FORM_KEY,
  diffFields: PO_EDIT_DIFF_FIELDS,

  async loadForDiff(tx, companyId, id): Promise<DocEditTarget | null> {
    const rows = await tx
      .select()
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.id, id),
          eq(purchaseOrders.companyId, companyId),
          isNull(purchaseOrders.deletedAt),
        ),
      )
      .limit(1)
      .for('update');
    const po = rows[0];
    if (!po) return null;
    // Vendor compared + displayed by CODE on both sides, so the inbox shows a
    // readable name and the drift check never compares a uuid to a code.
    const vendorCode = (await resolveVendorCode(tx, companyId, po.vendorId)) ?? po.vendorCodeText;
    return {
      doc: { ...po, vendorCode },
      updatedAt: po.updatedAt,
      docCode: po.code,
      // Draft edits apply directly; a cancelled PO is not editable. Everything
      // between is a LIVE document whose edits must be staged.
      isLive: po.status !== 'draft' && po.status !== 'cancelled',
    };
  },

  beforeSnapshot(target) {
    const d = target.doc;
    return {
      poDate: d['poDate'],
      vendorId: d['vendorCode'] ?? null,
      poType: d['poType'],
      dueDate: d['dueDate'],
      taxType: d['taxType'],
      prCodeText: d['prCodeText'],
      remarks: d['remarks'],
      sgstPct: d['sgstPct'],
      cgstPct: d['cgstPct'],
      igstPct: d['igstPct'],
    };
  },

  async afterSnapshot(tx, companyId, input, user) {
    const h = (input as UpdatePurchaseOrderInput).header ?? {};
    const out: Record<string, unknown> = {};
    if (h.poDate !== undefined) out['poDate'] = h.poDate;
    if (h.poType !== undefined) out['poType'] = h.poType;
    if (h.dueDate !== undefined) out['dueDate'] = h.dueDate ?? null;
    if (h.taxType !== undefined) out['taxType'] = h.taxType ?? null;
    if (h.prCodeText !== undefined) out['prCodeText'] = h.prCodeText ?? null;
    if (h.remarks !== undefined) out['remarks'] = h.remarks ?? null;
    if (h.vendorId !== undefined) {
      out['vendorId'] =
        (await resolveVendorCode(tx, companyId, h.vendorId ?? null)) ?? h.vendorCodeText ?? null;
    }
    // Money fields only when the actor may see prices — a price-blind payload
    // carries zod defaults that would otherwise read as a tax change.
    if (await canSeeFormPrice(user, PO_FORM_KEY)) {
      if (h.sgstPct !== undefined) out['sgstPct'] = h.sgstPct;
      if (h.cgstPct !== undefined) out['cgstPct'] = h.cgstPct;
      if (h.igstPct !== undefined) out['igstPct'] = h.igstPct;
    }
    return out;
  },

  buildFilteredInput(proposedPayload, approvedFields) {
    const input = proposedPayload as UpdatePurchaseOrderInput;
    const h = (input.header ?? {}) as Record<string, unknown>;
    const fh: Record<string, unknown> = {};
    for (const field of approvedFields) {
      if (field === 'vendorId') {
        if (h['vendorId'] !== undefined) fh['vendorId'] = h['vendorId'];
        if (h['vendorCodeText'] !== undefined) fh['vendorCodeText'] = h['vendorCodeText'];
      } else if (field in h) {
        fh[field] = h[field];
      }
    }
    if (Object.keys(fh).length === 0) return null;
    return { header: fh, expectedUpdatedAt: input.expectedUpdatedAt };
  },

  async applyEdit(tx, _companyId, id, filteredInput, expectedUpdatedAt, user) {
    const input = filteredInput as UpdatePurchaseOrderInput;
    // Per-change drift was already resolved by the engine under this tx's PO row
    // lock, so the whole-row updated_at check inside updatePurchaseOrderTx must
    // see the CURRENT token (a no-op match), not the request's original —
    // otherwise an unrelated field moving would block a valid partial apply.
    await updatePurchaseOrderTx(tx, id, { ...input, expectedUpdatedAt: expectedUpdatedAt ?? undefined }, user);
  },

  async loadUpdatedAts(tx, companyId, ids) {
    const map = new Map<string, Date | string | null>();
    if (ids.length === 0) return map;
    const rows = await tx
      .select({ id: purchaseOrders.id, updatedAt: purchaseOrders.updatedAt })
      .from(purchaseOrders)
      .where(and(inArray(purchaseOrders.id, ids), eq(purchaseOrders.companyId, companyId)));
    for (const r of rows) map.set(r.id, r.updatedAt);
    return map;
  },
};
