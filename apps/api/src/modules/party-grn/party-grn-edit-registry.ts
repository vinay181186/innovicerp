// PartyGrn entry for the edit-approval engine (ADR-202 Phase 3).
//
// RECORD/HEADER level + per waiting-QC line. Staged fields: the header's own
// (GRN Date, Customer Challan No., Remarks, Received By) and, for each line still
// WAITING for Incoming QC, its Received Qty and Remarks. A line already through
// QC is frozen — the service refuses editing it, and diffFields() never emits its
// keys, so it cannot be staged. applyEdit replays the approved subset through
// updatePartyGrnTx, so every guard (waiting-QC check, the §20.3 receipt cap under
// the JWSO-line lock, the before → after History diff) runs exactly as a direct
// edit. This entry is registered CENTRALLY in document-edits/registry.ts; this
// file only exports it.

import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { AccessFormKey } from '@innovic/shared';
import { partyGrn, partyGrnLines } from '../../db/schema';
import type { DiffField } from '../../lib/audit-trail';
import type { DocEditRegistryEntry, DocEditTarget } from '../document-edits/registry';
import type { UpdatePartyGrnInput } from './schema';
import { isPendingQc, PARTY_GRN_HEADER_FIELDS, updatePartyGrnTx } from './service';

const PARTY_GRN_FORM_KEY: AccessFormKey = 'party_create';

type LineAttr = 'qty' | 'remarks';
const LINE_ATTR_LABEL: Record<LineAttr, string> = {
  qty: 'Received Qty',
  remarks: 'Remarks',
};
const lineFieldKey = (lineId: string, attr: LineAttr): string => `line:${lineId}:${attr}`;

/** A waiting-QC line projected into target.doc — just what the diff needs. */
interface PartyGrnEditLine {
  id: string;
  lineNo: number;
  receivedQty: number;
  remarks: string | null;
}

export const partyGrnEditRegistryEntry: DocEditRegistryEntry = {
  formKey: PARTY_GRN_FORM_KEY,

  diffFields(target) {
    const lines = (target.doc['lines'] as PartyGrnEditLine[] | undefined) ?? [];
    const lineFields: DiffField[] = [];
    for (const l of lines) {
      lineFields.push({
        key: lineFieldKey(l.id, 'qty'),
        label: `Line ${l.lineNo} · ${LINE_ATTR_LABEL.qty}`,
      });
      lineFields.push({
        key: lineFieldKey(l.id, 'remarks'),
        label: `Line ${l.lineNo} · ${LINE_ATTR_LABEL.remarks}`,
      });
    }
    return [...PARTY_GRN_HEADER_FIELDS, ...lineFields];
  },

  async loadForDiff(tx, companyId, id): Promise<DocEditTarget | null> {
    const rows = await tx
      .select()
      .from(partyGrn)
      .where(and(eq(partyGrn.id, id), eq(partyGrn.companyId, companyId), isNull(partyGrn.deletedAt)))
      .limit(1)
      .for('update');
    const pg = rows[0];
    if (!pg) return null;

    // Lines locked under the same scope; only lines still WAITING for Incoming QC
    // are editable, so only they become diffable keys (mirror of grn isLive).
    const lineRows = await tx
      .select()
      .from(partyGrnLines)
      .where(
        and(
          eq(partyGrnLines.partyGrnId, id),
          eq(partyGrnLines.companyId, companyId),
          isNull(partyGrnLines.deletedAt),
        ),
      )
      .orderBy(asc(partyGrnLines.lineNo))
      .for('update');
    const pending: PartyGrnEditLine[] = lineRows
      .filter(isPendingQc)
      .map((l) => ({ id: l.id, lineNo: l.lineNo, receivedQty: l.receivedQty, remarks: l.remarks }));

    return {
      doc: {
        grnDate: pg.grnDate,
        dcNo: pg.dcNo,
        remarks: pg.remarks,
        receivedByText: pg.receivedByText,
        lines: pending,
      },
      updatedAt: pg.updatedAt,
      docCode: pg.code,
      // Live while any line still awaits QC; otherwise header edits apply direct.
      isLive: pending.length > 0,
    };
  },

  beforeSnapshot(target) {
    const d = target.doc;
    const out: Record<string, unknown> = {
      grnDate: d['grnDate'] ?? null,
      dcNo: d['dcNo'] ?? null,
      remarks: d['remarks'] ?? null,
      receivedByText: d['receivedByText'] ?? null,
    };
    const lines = (d['lines'] as PartyGrnEditLine[] | undefined) ?? [];
    for (const l of lines) {
      out[lineFieldKey(l.id, 'qty')] = l.receivedQty;
      out[lineFieldKey(l.id, 'remarks')] = l.remarks ?? null;
    }
    return out;
  },

  async afterSnapshot(_tx, _companyId, input, _user) {
    const i = input as UpdatePartyGrnInput;
    const out: Record<string, unknown> = {};
    if (i.grnDate !== undefined) out['grnDate'] = i.grnDate;
    if (i.dcNo !== undefined) out['dcNo'] = i.dcNo ?? null;
    if (i.remarks !== undefined) out['remarks'] = i.remarks ?? null;
    if (i.receivedByText !== undefined) out['receivedByText'] = i.receivedByText ?? null;
    // Line changes keyed by the proposed line's id. A key for an id that is no
    // longer a WAITING line is harmless — diffFields(target) is built from the
    // current waiting lines, so a stale key has no field to compare and is dropped.
    for (const l of i.lines ?? []) {
      if (l.receivedQty !== undefined) out[lineFieldKey(l.id, 'qty')] = l.receivedQty;
      if (l.remarks !== undefined) out[lineFieldKey(l.id, 'remarks')] = l.remarks ?? null;
    }
    return out;
  },

  buildFilteredInput(proposedPayload, approvedFields) {
    const input = proposedPayload as UpdatePartyGrnInput;
    const out: UpdatePartyGrnInput = {};
    const lineOut = new Map<string, { id: string; receivedQty?: number; remarks?: string | null }>();
    const proposedById = new Map((input.lines ?? []).map((l) => [l.id, l]));

    for (const field of approvedFields) {
      if (field === 'grnDate') {
        if (input.grnDate !== undefined) out.grnDate = input.grnDate;
      } else if (field === 'dcNo') {
        if (input.dcNo !== undefined) out.dcNo = input.dcNo;
      } else if (field === 'remarks') {
        if (input.remarks !== undefined) out.remarks = input.remarks;
      } else if (field === 'receivedByText') {
        if (input.receivedByText !== undefined) out.receivedByText = input.receivedByText;
      } else if (field.startsWith('line:')) {
        const parts = field.split(':');
        const lineId = parts[1];
        const attr = parts[2] as LineAttr | undefined;
        if (!lineId || !attr) continue;
        const proposed = proposedById.get(lineId);
        if (!proposed) continue;
        let line = lineOut.get(lineId);
        if (!line) {
          line = { id: lineId };
          lineOut.set(lineId, line);
        }
        if (attr === 'qty' && proposed.receivedQty !== undefined) line.receivedQty = proposed.receivedQty;
        if (attr === 'remarks' && proposed.remarks !== undefined) line.remarks = proposed.remarks;
      }
    }

    if (lineOut.size > 0) out.lines = [...lineOut.values()];
    const hasHeader =
      out.grnDate !== undefined ||
      out.dcNo !== undefined ||
      out.remarks !== undefined ||
      out.receivedByText !== undefined;
    if (!hasHeader && (out.lines?.length ?? 0) === 0) return null;
    return out;
  },

  async applyEdit(tx, _companyId, id, filteredInput, _expectedUpdatedAt, user) {
    // updatePartyGrnTx overwrites only the fields present on each line (partial
    // per-field update by id), so the filtered input — carrying ONLY the approved
    // keys — leaves every unapproved/superseded field at its current value. The
    // engine already holds this GRN row FOR UPDATE (loadForDiff, same tx), which
    // serialises concurrent approvals; the GRN writer is last-write-wins and
    // carries no token.
    await updatePartyGrnTx(tx, id, filteredInput as UpdatePartyGrnInput, user);
  },

  async loadUpdatedAts(tx, companyId, ids) {
    const map = new Map<string, Date | string | null>();
    if (ids.length === 0) return map;
    const rows = await tx
      .select({ id: partyGrn.id, updatedAt: partyGrn.updatedAt })
      .from(partyGrn)
      .where(and(inArray(partyGrn.id, ids), eq(partyGrn.companyId, companyId)));
    for (const r of rows) map.set(r.id, r.updatedAt);
    return map;
  },
};
