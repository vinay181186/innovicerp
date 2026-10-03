// PurchaseOrder entry for the edit-approval engine (ADR-202, Phase 1 + 1b).
//
// Phase 1 covered HEADER + tax + vendor changes. Phase 1b adds LINE-level changes
// (item / qty / rate) on EXISTING lines, approved PER CHANGE: an approver may
// approve a line's rate change and reject its qty change in the same request, and
// only the approved attr is written. Adding or removing a line stays refused for
// now (handled by the divert guard in service.ts).
//
// applyEdit replays the approved edit through updatePurchaseOrderTx, so every PO
// §20 guard (money-lock, revision bump, line merge, optimistic lock) runs exactly
// as a direct edit.

import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type {
  AccessFormKey,
  PurchaseOrderLineInput,
  UpdatePurchaseOrderInput,
} from '@innovic/shared';
import { items, purchaseOrderLines, purchaseOrders, vendors } from '../../db/schema';
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

// Header fields. Line fields are dynamic (one trio per current line) and are
// appended by diffFields() below, which is why diffFields is a function of the
// locked target rather than a static list.
const PO_HEADER_DIFF_FIELDS: readonly DiffField[] = [
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

// The three editable attrs of an existing line, each with the NAMING.md label.
const LINE_ATTRS = ['item', 'qty', 'rate'] as const;
type LineAttr = (typeof LINE_ATTRS)[number];
const LINE_ATTR_LABEL: Record<LineAttr, string> = {
  item: 'Item',
  qty: 'Order Qty',
  rate: 'Rate',
};
const lineFieldKey = (lineId: string, attr: LineAttr): string => `line:${lineId}:${attr}`;

/** A PO line projected into target.doc — just what diffFields / beforeSnapshot
 *  need. `itemCode` is the resolved master code (fallback: the free-text snapshot)
 *  so the item attr compares/displays a CODE on both sides, like vendor. */
interface PoEditLine {
  id: string;
  lineNo: number;
  itemId: string | null;
  itemCodeText: string | null;
  itemCode: string | null;
  qty: string | number;
  rate: string | number;
}

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

/** Master codes for a set of item ids (id → code), company-scoped. */
async function resolveItemCodesByIds(
  tx: DbTransaction,
  companyId: string,
  ids: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return map;
  const rows = await tx
    .select({ id: items.id, code: items.code })
    .from(items)
    .where(and(eq(items.companyId, companyId), inArray(items.id, unique)));
  for (const r of rows) map.set(r.id, r.code);
  return map;
}

/** The item CODE a proposed line resolves to: its master code when it carries an
 *  itemId, else its free-text snapshot (matches resolveLineItemRefs in service). */
function proposedItemCode(
  line: PurchaseOrderLineInput,
  codeById: Map<string, string>,
): string | null {
  if (line.itemId) return codeById.get(line.itemId) ?? null;
  return line.itemCodeText?.trim() ?? null;
}

export const poEditRegistryEntry: DocEditRegistryEntry = {
  formKey: PO_FORM_KEY,

  diffFields(target) {
    const lines = (target.doc['lines'] as PoEditLine[] | undefined) ?? [];
    const lineFields: DiffField[] = [];
    for (const l of lines) {
      for (const attr of LINE_ATTRS) {
        lineFields.push({
          key: lineFieldKey(l.id, attr),
          label: `Line ${l.lineNo} · ${LINE_ATTR_LABEL[attr]}`,
        });
      }
    }
    return [...PO_HEADER_DIFF_FIELDS, ...lineFields];
  },

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

    // Lines locked under the SAME FOR UPDATE scope — the dynamic diffFields,
    // snapshots and apply all read from this one projection.
    const lineRows = await tx
      .select({
        id: purchaseOrderLines.id,
        lineNo: purchaseOrderLines.lineNo,
        itemId: purchaseOrderLines.itemId,
        itemCodeText: purchaseOrderLines.itemCodeText,
        qty: purchaseOrderLines.qty,
        rate: purchaseOrderLines.rate,
      })
      .from(purchaseOrderLines)
      .where(
        and(
          eq(purchaseOrderLines.purchaseOrderId, id),
          eq(purchaseOrderLines.companyId, companyId),
          isNull(purchaseOrderLines.deletedAt),
        ),
      )
      .orderBy(asc(purchaseOrderLines.lineNo))
      .for('update');
    const codeById = await resolveItemCodesByIds(
      tx,
      companyId,
      lineRows.flatMap((l) => (l.itemId ? [l.itemId] : [])),
    );
    const lines: PoEditLine[] = lineRows.map((l) => ({
      id: l.id,
      lineNo: l.lineNo,
      itemId: l.itemId,
      itemCodeText: l.itemCodeText,
      itemCode: (l.itemId ? codeById.get(l.itemId) : null) ?? l.itemCodeText,
      qty: l.qty,
      rate: l.rate,
    }));

    return {
      doc: { ...po, vendorCode, lines },
      updatedAt: po.updatedAt,
      docCode: po.code,
      // Draft edits apply directly; a cancelled PO is not editable. Everything
      // between is a LIVE document whose edits must be staged.
      isLive: po.status !== 'draft' && po.status !== 'cancelled',
    };
  },

  beforeSnapshot(target) {
    const d = target.doc;
    const out: Record<string, unknown> = {
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
    const lines = (d['lines'] as PoEditLine[] | undefined) ?? [];
    for (const l of lines) {
      out[lineFieldKey(l.id, 'item')] = l.itemCode ?? null;
      out[lineFieldKey(l.id, 'qty')] = l.qty;
      out[lineFieldKey(l.id, 'rate')] = l.rate;
    }
    return out;
  },

  async afterSnapshot(tx, companyId, input, user) {
    const i = input as UpdatePurchaseOrderInput;
    const h = i.header ?? {};
    const showMoney = await canSeeFormPrice(user, PO_FORM_KEY);
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
    if (showMoney) {
      if (h.sgstPct !== undefined) out['sgstPct'] = h.sgstPct;
      if (h.cgstPct !== undefined) out['cgstPct'] = h.cgstPct;
      if (h.igstPct !== undefined) out['igstPct'] = h.igstPct;
    }

    // Line changes on EXISTING lines, keyed by the proposed line's id. A proposed
    // line with no id is a NEW line (add/remove is refused by the divert, never
    // staged), so it is skipped. A key for an id that is no longer a current line
    // is harmless — diffFields(target) is built from the current lines, so a stale
    // key has no field to compare against and is dropped.
    const lines = i.lines;
    if (lines && lines.length > 0) {
      const codeById = await resolveItemCodesByIds(
        tx,
        companyId,
        lines.flatMap((l) => (l.id && l.itemId ? [l.itemId] : [])),
      );
      for (const l of lines) {
        if (!l.id) continue;
        out[lineFieldKey(l.id, 'item')] = proposedItemCode(l, codeById);
        out[lineFieldKey(l.id, 'qty')] = l.qty;
        if (showMoney) out[lineFieldKey(l.id, 'rate')] = l.rate;
      }
    }
    return out;
  },

  buildFilteredInput(proposedPayload, approvedFields) {
    const input = proposedPayload as UpdatePurchaseOrderInput;
    const h = (input.header ?? {}) as Record<string, unknown>;
    const fh: Record<string, unknown> = {};
    const approvedLineFields: string[] = [];
    for (const field of approvedFields) {
      if (field.startsWith('line:')) {
        approvedLineFields.push(field);
      } else if (field === 'vendorId') {
        if (h['vendorId'] !== undefined) fh['vendorId'] = h['vendorId'];
        if (h['vendorCodeText'] !== undefined) fh['vendorCodeText'] = h['vendorCodeText'];
      } else if (field in h) {
        fh[field] = h[field];
      }
    }
    if (Object.keys(fh).length === 0 && approvedLineFields.length === 0) return null;
    // Carry the proposed lines so applyEdit can reconstruct each line from the
    // CURRENT values overwritten only by the approved attrs.
    return {
      header: fh,
      approvedLineFields,
      proposedLines: input.lines ?? [],
      expectedUpdatedAt: input.expectedUpdatedAt,
    };
  },

  async applyEdit(tx, companyId, id, filteredInput, expectedUpdatedAt, user) {
    const filtered = filteredInput as {
      header: Record<string, unknown>;
      approvedLineFields: string[];
      proposedLines: PurchaseOrderLineInput[];
      expectedUpdatedAt?: string;
    };
    const approvedLineFields = new Set(filtered.approvedLineFields);
    // Per-change drift was already resolved by the engine under this tx's PO row
    // lock, so the whole-row updated_at check inside updatePurchaseOrderTx must
    // see the CURRENT token (a no-op match), not the request's original —
    // otherwise an unrelated field moving would block a valid partial apply.
    const payload: UpdatePurchaseOrderInput = {
      header: filtered.header as UpdatePurchaseOrderInput['header'],
      expectedUpdatedAt: expectedUpdatedAt ?? undefined,
    };

    if (approvedLineFields.size > 0) {
      // Reload the CURRENT lines and rebuild the full line array: start from each
      // current line's values, then overwrite ONLY the approved attr(s) with the
      // proposed value. Every current line is resubmitted WITH its id, so none is
      // dropped, and an unapproved/superseded attr keeps its current value — a
      // rejected line change is therefore NEVER applied.
      const current = await tx
        .select()
        .from(purchaseOrderLines)
        .where(
          and(
            eq(purchaseOrderLines.purchaseOrderId, id),
            eq(purchaseOrderLines.companyId, companyId),
            isNull(purchaseOrderLines.deletedAt),
          ),
        )
        .orderBy(asc(purchaseOrderLines.lineNo));
      const proposedById = new Map(
        filtered.proposedLines.filter((l) => l.id).map((l) => [l.id!, l]),
      );

      payload.lines = current.map((c) => {
        const line: PurchaseOrderLineInput = {
          id: c.id,
          lineNo: c.lineNo,
          itemName: c.itemName,
          qty: Number(c.qty),
          rate: Number(c.rate),
          ...(c.itemId ? { itemId: c.itemId } : {}),
          ...(c.itemId ? {} : c.itemCodeText ? { itemCodeText: c.itemCodeText } : {}),
          ...(c.dueDate ? { dueDate: c.dueDate } : {}),
          ...(c.sourcePrId ? { sourcePrId: c.sourcePrId } : {}),
          ...(c.sourceJcOpId ? { sourceJcOpId: c.sourceJcOpId } : {}),
          ...(c.sourceSoLineId ? { sourceSoLineId: c.sourceSoLineId } : {}),
          ...(c.ramRemark != null ? { ramRemark: c.ramRemark } : {}),
          ...(c.lineRemarks != null ? { lineRemarks: c.lineRemarks } : {}),
        };
        const proposed = proposedById.get(c.id);
        if (proposed) {
          if (approvedLineFields.has(lineFieldKey(c.id, 'item'))) {
            if (proposed.itemId) {
              line.itemId = proposed.itemId;
              delete line.itemCodeText;
            } else if (proposed.itemCodeText) {
              delete line.itemId;
              line.itemCodeText = proposed.itemCodeText;
            }
          }
          if (approvedLineFields.has(lineFieldKey(c.id, 'qty'))) line.qty = proposed.qty;
          if (approvedLineFields.has(lineFieldKey(c.id, 'rate'))) line.rate = proposed.rate;
        }
        return line;
      });
    }

    await updatePurchaseOrderTx(tx, id, payload, user);
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
