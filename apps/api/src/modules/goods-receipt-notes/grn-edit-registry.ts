// GoodsReceiptNote entry for the edit-approval engine (ADR-202).
//
// RECORD/HEADER level only: this pass stages the GRN's own header fields (the set
// the module's EDIT diff emits — GRN_HEADER_FIELDS). A GRN's received lines are
// NOT staged — a line change is refused by the divert guard in service.ts
// (grnChildRowsChanged), and a QC-inspected line is already frozen by the ADR-189
// per-line checks in mergeLines. applyEdit replays the approved subset through
// updateGoodsReceiptNoteTx, so every GRN guard (vendor / PO existence, the
// QC-frozen line checks, the before → after History diff) runs exactly as a
// direct edit. This entry is registered CENTRALLY in document-edits/registry.ts;
// this file only exports it.

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { AccessFormKey, UpdateGoodsReceiptNoteInput } from '@innovic/shared';
import {
  goodsReceiptNoteLines,
  goodsReceiptNotes,
  purchaseOrders,
  vendors,
} from '../../db/schema';
import type { DbTransaction } from '../../db/with-user-context';
import type { DiffField } from '../../lib/audit-trail';
import type { DocEditRegistryEntry, DocEditTarget } from '../document-edits/registry';
import { GRN_HEADER_FIELDS, readGrnAuditSnapshot, updateGoodsReceiptNoteTx } from './service';

const GRN_FORM_KEY: AccessFormKey = 'grn_create';

/** The PO code a master purchaseOrderId resolves to, company-scoped — the GRN
 *  diff reads COALESCE(po.code, poCodeText) under the `poNo` key, so the proposed
 *  value must resolve the same way the History snapshot does. */
async function poCodeOf(
  tx: DbTransaction,
  companyId: string,
  poId: string | null,
): Promise<string | null> {
  if (!poId) return null;
  const rows = await tx
    .select({ code: purchaseOrders.code })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, poId), eq(purchaseOrders.companyId, companyId)))
    .limit(1);
  return rows[0]?.code ?? null;
}

/** The vendor code a master vendorId resolves to, company-scoped — same
 *  COALESCE(vendor.code, vendorCodeText) as the History snapshot's `vendor`. */
async function vendorCodeOf(
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

export const grnEditRegistryEntry: DocEditRegistryEntry = {
  formKey: GRN_FORM_KEY,

  diffFields(): readonly DiffField[] {
    // The same header fields the History tab shows.
    return [...GRN_HEADER_FIELDS];
  },

  async loadForDiff(tx, companyId, id): Promise<DocEditTarget | null> {
    const rows = await tx
      .select()
      .from(goodsReceiptNotes)
      .where(
        and(
          eq(goodsReceiptNotes.id, id),
          eq(goodsReceiptNotes.companyId, companyId),
          isNull(goodsReceiptNotes.deletedAt),
        ),
      )
      .limit(1)
      .for('update');
    const grn = rows[0];
    if (!grn) return null;
    // The display header (poNo / vendor resolved via COALESCE) the diff compares.
    const snap = await readGrnAuditSnapshot(tx, id);
    // isLive mirrors grnStatus: 'pending' (live) while ANY line still has QC qty
    // remaining; 'close' (fully QC-inspected) edits directly, like a draft. GRN
    // has no cancelled state.
    const waiting = await tx
      .select({ id: goodsReceiptNoteLines.id })
      .from(goodsReceiptNoteLines)
      .where(
        and(
          eq(goodsReceiptNoteLines.goodsReceiptNoteId, id),
          isNull(goodsReceiptNoteLines.deletedAt),
          sql`(${goodsReceiptNoteLines.receivedQty} - ${goodsReceiptNoteLines.qcAcceptedQty} - ${goodsReceiptNoteLines.qcRejectedQty}) > 0`,
        ),
      )
      .limit(1);
    return {
      doc: { ...snap.header },
      updatedAt: grn.updatedAt,
      docCode: grn.code,
      isLive: waiting.length > 0,
    };
  },

  beforeSnapshot(target) {
    const d = target.doc;
    return {
      grnDate: d['grnDate'] ?? null,
      poNo: d['poNo'] ?? null,
      vendor: d['vendor'] ?? null,
      dcNo: d['dcNo'] ?? null,
      invoiceNo: d['invoiceNo'] ?? null,
      remarks: d['remarks'] ?? null,
    };
  },

  async afterSnapshot(tx, companyId, input, _user) {
    const i = input as UpdateGoodsReceiptNoteInput;
    const h = i.header ?? {};
    const out: Record<string, unknown> = {};
    if (h.grnDate !== undefined) out['grnDate'] = h.grnDate;
    if (h.dcNo !== undefined) out['dcNo'] = h.dcNo ?? null;
    if (h.invoiceNo !== undefined) out['invoiceNo'] = h.invoiceNo ?? null;
    if (h.remarks !== undefined) out['remarks'] = h.remarks ?? null;
    // PO No. and Vendor render as COALESCE(master code, typed text) — the same
    // display the History diff reads. The GRN edit form sends the id and its
    // code-text together, so the proposed value is computed from the submitted
    // pair: the master code when an id is set, else the typed text.
    if (h.purchaseOrderId !== undefined || h.poCodeText !== undefined) {
      const poId = h.purchaseOrderId ?? null;
      out['poNo'] = poId ? await poCodeOf(tx, companyId, poId) : (h.poCodeText ?? null);
    }
    if (h.vendorId !== undefined || h.vendorCodeText !== undefined) {
      const vId = h.vendorId ?? null;
      out['vendor'] = vId ? await vendorCodeOf(tx, companyId, vId) : (h.vendorCodeText ?? null);
    }
    return out;
  },

  buildFilteredInput(proposedPayload, approvedFields) {
    const input = proposedPayload as UpdateGoodsReceiptNoteInput;
    const h = (input.header ?? {}) as Record<string, unknown>;
    const fh: Record<string, unknown> = {};
    const copy = (k: string): void => {
      if (h[k] !== undefined) fh[k] = h[k];
    };
    for (const field of approvedFields) {
      if (field === 'poNo') {
        // The PO fact travels as the id (+ its code-text snapshot).
        copy('purchaseOrderId');
        copy('poCodeText');
      } else if (field === 'vendor') {
        // The vendor fact travels as the id (+ its code-text snapshot).
        copy('vendorId');
        copy('vendorCodeText');
      } else {
        copy(field); // grnDate, dcNo, invoiceNo, remarks
      }
    }
    if (Object.keys(fh).length === 0) return null;
    return { header: fh };
  },

  async applyEdit(tx, _companyId, id, filteredInput, _expectedUpdatedAt, user) {
    const filtered = filteredInput as { header: Record<string, unknown> };
    // The GRN writer carries no expectedUpdatedAt token (last-write-wins). The
    // engine already holds this GRN row FOR UPDATE (loadForDiff, same tx), which
    // serialises concurrent approvals, so the token is not needed here.
    await updateGoodsReceiptNoteTx(
      tx,
      id,
      { header: filtered.header as UpdateGoodsReceiptNoteInput['header'] },
      user,
    );
  },

  async loadUpdatedAts(tx, companyId, ids) {
    const map = new Map<string, Date | string | null>();
    if (ids.length === 0) return map;
    const rows = await tx
      .select({ id: goodsReceiptNotes.id, updatedAt: goodsReceiptNotes.updatedAt })
      .from(goodsReceiptNotes)
      .where(and(inArray(goodsReceiptNotes.id, ids), eq(goodsReceiptNotes.companyId, companyId)));
    for (const r of rows) map.set(r.id, r.updatedAt);
    return map;
  },
};
