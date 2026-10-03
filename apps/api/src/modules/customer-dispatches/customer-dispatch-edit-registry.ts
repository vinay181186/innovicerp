// Dispatch (Customer Dispatch) entry for the edit-approval engine (ADR-202,
// Phase 3). This is the STOCK-CRITICAL document: the per-line Dispatch Qty is the
// whole point of the edit, so it is STAGED (not refused). On approval the engine
// replays the approved subset through updateCustomerDispatchTx, which REVERSES the
// old stock movement and REPOSTS the corrected one in one transaction — so every
// dispatch guard (header FOR UPDATE, SO-line / item locks, invoice guard,
// Dispatchable / Pending caps, the §20.1 single stock writer) runs exactly as a
// direct edit. The line SET is fixed (a dispatch's items come from the SO
// selection); applyEdit rebuilds the full line set from the CURRENT qtys and
// overwrites only approved `line:<id>:qty`, so a rejected / superseded line qty
// keeps its current value and no line is ever added or dropped.
//
// Registered CENTRALLY in document-edits/registry.ts; this file only exports the
// entry.

import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { AccessFormKey } from '@innovic/shared';
import { customerDispatchLines, customerDispatches } from '../../db/schema';
import type { DiffField } from '../../lib/audit-trail';
import type { DocEditRegistryEntry, DocEditTarget } from '../document-edits/registry';
import {
  DISPATCH_HEADER_EDIT_FIELDS,
  dispatchLineDiffFields,
  dispatchLineQtyKey,
} from './edit-fields';
import type { UpdateCustomerDispatchInput } from './schema';
import { updateCustomerDispatchTx } from './service';

const DISPATCH_FORM_KEY: AccessFormKey = 'dispatch_create';

/** A dispatch line projected into target.doc — just what diffFields /
 *  beforeSnapshot need. */
interface DispatchEditLine {
  id: string;
  lineNo: number;
  qty: string | number;
}

/** The shape buildFilteredInput emits for applyEdit to reconstruct from. */
interface DispatchFilteredInput {
  header: Partial<Pick<UpdateCustomerDispatchInput, 'dispatchDate' | 'transport' | 'vehicleNo' | 'remarks'>>;
  approvedLineKeys: string[];
  proposedLines: ReadonlyArray<{ id: string; qty: number }>;
  expectedUpdatedAt?: string;
}

export const customerDispatchEditRegistryEntry: DocEditRegistryEntry = {
  formKey: DISPATCH_FORM_KEY,

  diffFields(target): readonly DiffField[] {
    const lines = (target.doc['lines'] as DispatchEditLine[] | undefined) ?? [];
    return [...DISPATCH_HEADER_EDIT_FIELDS, ...dispatchLineDiffFields(lines)];
  },

  async loadForDiff(tx, companyId, id): Promise<DocEditTarget | null> {
    const rows = await tx
      .select()
      .from(customerDispatches)
      .where(
        and(
          eq(customerDispatches.id, id),
          eq(customerDispatches.companyId, companyId),
          isNull(customerDispatches.deletedAt),
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
        id: customerDispatchLines.id,
        lineNo: customerDispatchLines.lineNo,
        qty: customerDispatchLines.qty,
      })
      .from(customerDispatchLines)
      .where(
        and(
          eq(customerDispatchLines.customerDispatchId, id),
          isNull(customerDispatchLines.deletedAt),
        ),
      )
      .orderBy(asc(customerDispatchLines.lineNo))
      .for('update');
    const lines: DispatchEditLine[] = lineRows.map((l) => ({
      id: l.id,
      lineNo: l.lineNo,
      qty: l.qty,
    }));

    return {
      doc: { ...h, lines },
      updatedAt: h.updatedAt,
      docCode: h.code,
      // A cancelled dispatch is not editable; every other status is LIVE (a
      // dispatch has no draft state — it is created already 'dispatched').
      isLive: h.status !== 'cancelled',
    };
  },

  beforeSnapshot(target) {
    const d = target.doc;
    const out: Record<string, unknown> = {
      dispatchDate: d['dispatchDate'],
      transport: d['transport'] ?? null,
      vehicleNo: d['vehicleNo'] ?? null,
      remarks: d['remarks'] ?? null,
    };
    const lines = (d['lines'] as DispatchEditLine[] | undefined) ?? [];
    for (const l of lines) out[dispatchLineQtyKey(l.id)] = l.qty;
    return out;
  },

  async afterSnapshot(_tx, _companyId, input, _user) {
    const i = input as UpdateCustomerDispatchInput;
    const out: Record<string, unknown> = {};
    if (i.dispatchDate !== undefined) out['dispatchDate'] = i.dispatchDate;
    if (i.transport !== undefined) out['transport'] = i.transport ?? null;
    if (i.vehicleNo !== undefined) out['vehicleNo'] = i.vehicleNo ?? null;
    if (i.remarks !== undefined) out['remarks'] = i.remarks ?? null;
    for (const l of i.lines) out[dispatchLineQtyKey(l.id)] = l.qty;
    return out;
  },

  buildFilteredInput(proposedPayload, approvedFields) {
    const input = proposedPayload as UpdateCustomerDispatchInput;
    const header: DispatchFilteredInput['header'] = {};
    const approvedLineKeys: string[] = [];
    for (const field of approvedFields) {
      if (field.startsWith('line:')) {
        approvedLineKeys.push(field);
      } else if (field === 'dispatchDate' && input.dispatchDate !== undefined) {
        header.dispatchDate = input.dispatchDate;
      } else if (field === 'transport' && input.transport !== undefined) {
        header.transport = input.transport;
      } else if (field === 'vehicleNo' && input.vehicleNo !== undefined) {
        header.vehicleNo = input.vehicleNo;
      } else if (field === 'remarks' && input.remarks !== undefined) {
        header.remarks = input.remarks;
      }
    }
    if (Object.keys(header).length === 0 && approvedLineKeys.length === 0) return null;
    // Carry the proposed lines so applyEdit can reconstruct each line from the
    // CURRENT qtys overwritten only by the approved line keys.
    return {
      header,
      approvedLineKeys,
      proposedLines: input.lines,
      ...(input.expectedUpdatedAt !== undefined ? { expectedUpdatedAt: input.expectedUpdatedAt } : {}),
    } satisfies DispatchFilteredInput;
  },

  async applyEdit(tx, companyId, id, filteredInput, expectedUpdatedAt, user) {
    const f = filteredInput as DispatchFilteredInput;
    const approved = new Set(f.approvedLineKeys);
    // Reload the CURRENT lines and rebuild the full line array: start from each
    // current qty, overwrite ONLY the approved line:<id>:qty with the proposed
    // value. Every current line is resubmitted, so none is dropped and a
    // rejected / superseded qty keeps its current value.
    const current = await tx
      .select({ id: customerDispatchLines.id, qty: customerDispatchLines.qty })
      .from(customerDispatchLines)
      .where(
        and(
          eq(customerDispatchLines.customerDispatchId, id),
          eq(customerDispatchLines.companyId, companyId),
          isNull(customerDispatchLines.deletedAt),
        ),
      )
      .orderBy(asc(customerDispatchLines.lineNo));
    const proposedById = new Map(f.proposedLines.map((l) => [l.id, l]));
    const lines = current.map((c) => {
      let qty = Number(c.qty);
      if (approved.has(dispatchLineQtyKey(c.id))) {
        const p = proposedById.get(c.id);
        if (p) qty = p.qty;
      }
      return { id: c.id, qty };
    });

    await updateCustomerDispatchTx(
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
      .select({ id: customerDispatches.id, updatedAt: customerDispatches.updatedAt })
      .from(customerDispatches)
      .where(and(inArray(customerDispatches.id, ids), eq(customerDispatches.companyId, companyId)));
    for (const r of rows) map.set(r.id, r.updatedAt);
    return map;
  },
};
