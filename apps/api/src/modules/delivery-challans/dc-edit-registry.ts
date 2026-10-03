// OSP Delivery Challan entry for the edit-approval engine (ADR-202, Phase 3).
//
// The OSP DC is STOCK-NEUTRAL (ADR-067): no stock ledger, no rate. The per-line
// Challan Qty is the point of the edit because it drives the job-card op counter
// jc_ops.outsource_sent_qty, so it is STAGED (not refused). On approval the engine
// replays the approved subset through updateDeliveryChallanTx, which REVERSES the
// op counter for the current qty and REPOSTS it for the new qty in one
// transaction — so every DC guard (header FOR UPDATE, op lock, sendable + PO-line
// caps, the §20.1 single counter writer) runs exactly as a direct edit. The line
// SET is fixed (a DC's items come from the PO selection); applyEdit rebuilds the
// full line set from the CURRENT values and overwrites only approved
// `line:<id>:qty|material|remarks`, so a rejected / superseded change keeps its
// current value and no line is ever added or dropped.
//
// Registered CENTRALLY in document-edits/registry.ts; this file only exports the
// entry.

import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { AccessFormKey } from '@innovic/shared';
import { deliveryChallanLines, deliveryChallans } from '../../db/schema';
import type { DiffField } from '../../lib/audit-trail';
import type { DocEditRegistryEntry, DocEditTarget } from '../document-edits/registry';
import {
  DC_HEADER_EDIT_FIELDS,
  dcLineDiffFields,
  dcLineMaterialKey,
  dcLineQtyKey,
  dcLineRemarksKey,
} from './edit-fields';
import { dcHasActiveReceipts } from './receipt-cascades';
import type { UpdateDeliveryChallanInput } from './schema';
import { updateDeliveryChallanTx } from './service';

const DC_FORM_KEY: AccessFormKey = 'ospdc_create';

/** A DC line projected into target.doc — just what diffFields / beforeSnapshot
 *  need. */
interface DcEditLine {
  id: string;
  lineNo: number;
  qty: string | number;
  materialText: string | null;
  dcRemarks: string | null;
}

/** The shape buildFilteredInput emits for applyEdit to reconstruct from. */
interface DcFilteredInput {
  header: Partial<Pick<UpdateDeliveryChallanInput, 'dcDate' | 'transport' | 'vehicleNo'>>;
  approvedLineKeys: string[];
  proposedLines: UpdateDeliveryChallanInput['lines'];
  expectedUpdatedAt?: string;
}

export const dcEditRegistryEntry: DocEditRegistryEntry = {
  formKey: DC_FORM_KEY,

  diffFields(target): readonly DiffField[] {
    const lines = (target.doc['lines'] as DcEditLine[] | undefined) ?? [];
    return [...DC_HEADER_EDIT_FIELDS, ...dcLineDiffFields(lines)];
  },

  async loadForDiff(tx, companyId, id): Promise<DocEditTarget | null> {
    const rows = await tx
      .select()
      .from(deliveryChallans)
      .where(
        and(
          eq(deliveryChallans.id, id),
          eq(deliveryChallans.companyId, companyId),
          isNull(deliveryChallans.deletedAt),
        ),
      )
      .limit(1)
      .for('update');
    const h = rows[0];
    if (!h) return null;

    // Lines locked under the SAME FOR UPDATE scope — diffFields, snapshots and
    // apply all read from this one projection.
    const lineRows = await tx
      .select({
        id: deliveryChallanLines.id,
        lineNo: deliveryChallanLines.lineNo,
        qty: deliveryChallanLines.qty,
        materialText: deliveryChallanLines.materialText,
        dcRemarks: deliveryChallanLines.dcRemarks,
      })
      .from(deliveryChallanLines)
      .where(
        and(
          eq(deliveryChallanLines.deliveryChallanId, id),
          isNull(deliveryChallanLines.deletedAt),
        ),
      )
      .orderBy(asc(deliveryChallanLines.lineNo))
      .for('update');
    const lines: DcEditLine[] = lineRows.map((l) => ({
      id: l.id,
      lineNo: l.lineNo,
      qty: l.qty,
      materialText: l.materialText,
      dcRemarks: l.dcRemarks,
    }));

    // Only an issued DC with no receipts and no NC return-to-vendor link is LIVE
    // (and editable). Everything else edits nothing — the engine stages nothing.
    const hasReceipts = await dcHasActiveReceipts(tx, id);
    return {
      doc: { ...h, lines },
      updatedAt: h.updatedAt,
      docCode: h.code,
      isLive: h.status === 'issued' && !h.ncId && !hasReceipts,
    };
  },

  beforeSnapshot(target) {
    const d = target.doc;
    const out: Record<string, unknown> = {
      dcDate: d['dcDate'],
      transport: d['transport'] ?? null,
      vehicleNo: d['vehicleNo'] ?? null,
    };
    const lines = (d['lines'] as DcEditLine[] | undefined) ?? [];
    for (const l of lines) {
      out[dcLineQtyKey(l.id)] = l.qty;
      out[dcLineMaterialKey(l.id)] = l.materialText;
      out[dcLineRemarksKey(l.id)] = l.dcRemarks;
    }
    return out;
  },

  async afterSnapshot(_tx, _companyId, input, _user) {
    const i = input as UpdateDeliveryChallanInput;
    const out: Record<string, unknown> = {};
    if (i.dcDate !== undefined) out['dcDate'] = i.dcDate;
    if (i.transport !== undefined) out['transport'] = i.transport ?? null;
    if (i.vehicleNo !== undefined) out['vehicleNo'] = i.vehicleNo ?? null;
    for (const l of i.lines) {
      out[dcLineQtyKey(l.id)] = l.qty;
      if (l.materialText !== undefined) out[dcLineMaterialKey(l.id)] = l.materialText ?? null;
      if (l.dcRemarks !== undefined) out[dcLineRemarksKey(l.id)] = l.dcRemarks ?? null;
    }
    return out;
  },

  buildFilteredInput(proposedPayload, approvedFields) {
    const input = proposedPayload as UpdateDeliveryChallanInput;
    const header: DcFilteredInput['header'] = {};
    const approvedLineKeys: string[] = [];
    for (const field of approvedFields) {
      if (field.startsWith('line:')) {
        approvedLineKeys.push(field);
      } else if (field === 'dcDate' && input.dcDate !== undefined) {
        header.dcDate = input.dcDate;
      } else if (field === 'transport' && input.transport !== undefined) {
        header.transport = input.transport;
      } else if (field === 'vehicleNo' && input.vehicleNo !== undefined) {
        header.vehicleNo = input.vehicleNo;
      }
    }
    if (Object.keys(header).length === 0 && approvedLineKeys.length === 0) return null;
    // Carry the proposed lines so applyEdit can reconstruct each line from the
    // CURRENT values overwritten only by the approved line keys.
    return {
      header,
      approvedLineKeys,
      proposedLines: input.lines,
      ...(input.expectedUpdatedAt !== undefined
        ? { expectedUpdatedAt: input.expectedUpdatedAt }
        : {}),
    } satisfies DcFilteredInput;
  },

  async applyEdit(tx, companyId, id, filteredInput, expectedUpdatedAt, user) {
    const f = filteredInput as DcFilteredInput;
    const approved = new Set(f.approvedLineKeys);
    // Reload the CURRENT lines and rebuild the full line array: start from each
    // current value, overwrite ONLY the approved key(s) with the proposed value.
    // Every current line is resubmitted, so none is dropped and a rejected /
    // superseded change keeps its current value.
    const current = await tx
      .select({
        id: deliveryChallanLines.id,
        qty: deliveryChallanLines.qty,
        materialText: deliveryChallanLines.materialText,
        dcRemarks: deliveryChallanLines.dcRemarks,
      })
      .from(deliveryChallanLines)
      .where(
        and(
          eq(deliveryChallanLines.deliveryChallanId, id),
          eq(deliveryChallanLines.companyId, companyId),
          isNull(deliveryChallanLines.deletedAt),
        ),
      )
      .orderBy(asc(deliveryChallanLines.lineNo));
    const proposedById = new Map(f.proposedLines.map((l) => [l.id, l]));
    const lines = current.map((c) => {
      const p = proposedById.get(c.id);
      const line: UpdateDeliveryChallanInput['lines'][number] = {
        id: c.id,
        qty: Number(c.qty),
        materialText: c.materialText,
        dcRemarks: c.dcRemarks,
      };
      if (p) {
        if (approved.has(dcLineQtyKey(c.id))) line.qty = p.qty;
        if (approved.has(dcLineMaterialKey(c.id))) line.materialText = p.materialText ?? null;
        if (approved.has(dcLineRemarksKey(c.id))) line.dcRemarks = p.dcRemarks ?? null;
      }
      return line;
    });

    await updateDeliveryChallanTx(
      tx,
      id,
      {
        ...f.header,
        lines,
        ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
      },
      user,
    );
  },

  async loadUpdatedAts(tx, companyId, ids) {
    const map = new Map<string, Date | string | null>();
    if (ids.length === 0) return map;
    const rows = await tx
      .select({ id: deliveryChallans.id, updatedAt: deliveryChallans.updatedAt })
      .from(deliveryChallans)
      .where(and(inArray(deliveryChallans.id, ids), eq(deliveryChallans.companyId, companyId)));
    for (const r of rows) map.set(r.id, r.updatedAt);
    return map;
  },
};
