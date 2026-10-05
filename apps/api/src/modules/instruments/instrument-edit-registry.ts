// Instrument (Instrument Register) entry for the edit-approval engine (ADR-202,
// Phase 2c).
//
// RECORD-level: an instrument is a single record with no child lines, so every
// editable field is a header field and there is no line guard. applyEdit replays
// the approved subset through updateInstrumentTx, so every guard runs exactly as
// a direct edit — the Serial-No. edit rule and the module's own free-text EDIT
// log. Concurrency is the engine's: loadForDiff locks the row FOR UPDATE and the
// engine rechecks field freshness, so this register needs no updatedAt token of
// its own (updateInstrumentTx re-locks the same row in the same tx — a no-op).
//
// The register has no money column, so there is no price-gated field here.

import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { AccessFormKey, UpdateInstrumentInput } from '@innovic/shared';
import { instruments, items } from '../../db/schema';
import type { DiffField } from '../../lib/audit-trail';
import type { DocEditRegistryEntry, DocEditTarget } from '../document-edits/registry';
import { INSTRUMENT_EDIT_FIELDS, updateInstrumentTx } from './service';

const INSTRUMENT_FORM_KEY: AccessFormKey = 'toolissue_create';

export const instrumentEditRegistryEntry: DocEditRegistryEntry = {
  formKey: INSTRUMENT_FORM_KEY,

  diffFields(): readonly DiffField[] {
    return INSTRUMENT_EDIT_FIELDS;
  },

  async loadForDiff(tx, companyId, id): Promise<DocEditTarget | null> {
    const rows = await tx
      .select()
      .from(instruments)
      .where(
        and(
          eq(instruments.id, id),
          eq(instruments.companyId, companyId),
          isNull(instruments.deletedAt),
        ),
      )
      .limit(1)
      .for('update');
    const row = rows[0];
    if (!row) return null;
    // The instrument has no code column; the shop floor names it by its item code
    // and Serial No. (the same pair the module's EDIT log uses as its ref).
    const codeRows = await tx
      .select({ code: items.code })
      .from(items)
      .where(eq(items.id, row.itemId))
      .limit(1);
    const code = codeRows[0]?.code ?? '';
    return {
      doc: { ...row },
      updatedAt: row.updatedAt,
      docCode: `${code} / ${row.serialNo}`,
      // An instrument is editable as long as it is not in Trash.
      isLive: true,
    };
  },

  beforeSnapshot(target) {
    const d = target.doc;
    return {
      serialNo: d['serialNo'],
      calibrationIntervalDays: d['calibrationIntervalDays'],
      location: d['location'],
      remarks: d['remarks'],
    };
  },

  afterSnapshot(_tx, _companyId, input) {
    const i = input as UpdateInstrumentInput;
    const out: Record<string, unknown> = {};
    if (i.serialNo !== undefined) out['serialNo'] = i.serialNo;
    if (i.calibrationIntervalDays !== undefined)
      out['calibrationIntervalDays'] = i.calibrationIntervalDays;
    if (i.location !== undefined) out['location'] = i.location ?? null;
    if (i.remarks !== undefined) out['remarks'] = i.remarks ?? null;
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

  async applyEdit(tx, _companyId, id, filteredInput, _expectedUpdatedAt, user) {
    await updateInstrumentTx(tx, id, filteredInput as UpdateInstrumentInput, user);
  },

  async loadUpdatedAts(tx, companyId, ids) {
    const map = new Map<string, Date | string | null>();
    if (ids.length === 0) return map;
    const rows = await tx
      .select({ id: instruments.id, updatedAt: instruments.updatedAt })
      .from(instruments)
      .where(and(inArray(instruments.id, ids), eq(instruments.companyId, companyId)));
    for (const r of rows) map.set(r.id, r.updatedAt);
    return map;
  },
};
