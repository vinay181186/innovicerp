// Instrument register writes (ADR-193 phase 4a, spec §14). Form key
// toolissue_create 'entry' for every write here; reads live in read.ts.
//
//   register            names a piece already received (P35: In Store + At
//                       Calibration ≤ On Hand) — never moves stock
//   edit                interval / location / remarks
//   calibration-out     In Store → At Calibration (no stock move; P43: not
//                       while a write-off is pending)
//   calibrate           Pass → due = nextDueOn ?? date + interval;
//                       Fail → due = the calibration date (P41: blocked from
//                       issue until a Pass or a Scrap); status → In Store
//   scrap               In Store only → a pending 'scrap' write-off (the Store
//                       In-charge decides in the Tool Issue module)
//   mark-missing        In Store only → a pending 'lost' write-off, no Tool Issue
//   edit Serial No.     only if it never went out on a Tool Issue
// Every status change locks the instrument row first (P42).

import type {
  CreateInstrumentInput,
  DocumentEditStagedResult,
  InstrumentListItem,
  MarkMissingInstrumentInput,
  RecordCalibrationInput,
  ScrapInstrumentInput,
  SendForCalibrationInput,
  UpdateInstrumentInput,
} from '@innovic/shared';
import { INSTRUMENT_STATUS_LABELS } from '@innovic/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { instrumentCalibrations, instruments, toolWriteoffs } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import type { DiffField } from '../../lib/audit-trail';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { countInstrumentsInStore, lockItemForStock, roundQty } from '../../lib/stock-ledger';
import { readStockPosition } from '../../lib/stock-reservation';
import { emitActivityLog } from '../activity-log/service';
import { addDays, lockInstrument, requireCompany, todayIst } from './common';
import { readInstrument } from './read';

export { getInstrument, listInstruments, listUnregistered } from './read';

const FORM = 'toolissue_create' as const;
const ENTITY = 'Instrument';

/** The user-editable Instrument fields updateInstrument may set, with their
 *  screen labels (NAMING.md), for the edit-approval engine's diff
 *  (instrument-edit-registry.ts). The free-text EDIT log the module already
 *  writes is unchanged — this is the STRUCTURED Before → After the engine needs.
 *  Status / calibration dates move through their own guarded actions, not here. */
export const INSTRUMENT_EDIT_FIELDS: readonly DiffField[] = [
  { key: 'serialNo', label: 'Instrument Serial No.' },
  { key: 'calibrationIntervalDays', label: 'Calibration Interval (days)' },
  { key: 'location', label: 'Location' },
  { key: 'remarks', label: 'Remarks' },
];

async function log(
  tx: DbTransaction,
  companyId: string,
  user: AuthContext,
  action: string,
  detail: string,
  refId: string,
): Promise<void> {
  await emitActivityLog(tx, { action, entity: ENTITY, detail, refId }, companyId, user);
}

async function itemCodeOf(tx: DbTransaction, itemId: string): Promise<string> {
  const rows = (await tx.execute(sql`
    SELECT code FROM public.items WHERE id = ${itemId}::uuid
  `)) as unknown as Array<{ code: string }>;
  return rows[0]?.code ?? '';
}

/** A Serial No. may be corrected only before the piece ever went out, and
 *  never onto another live Serial No. of the same item (case-insensitive). */
async function assertSerialEditable(
  tx: DbTransaction,
  companyId: string,
  cur: { id: string; itemId: string; serialNo: string },
  code: string,
  newSerial: string,
): Promise<void> {
  const used = (await tx.execute(sql`
    SELECT 1 FROM public.tool_issue_instruments WHERE instrument_id = ${cur.id}::uuid LIMIT 1
  `)) as unknown as unknown[];
  if (used.length > 0) {
    throw new ConflictError(
      `${code}: Instrument Serial No. ${cur.serialNo} has been on a Tool Issue — it cannot be changed.`,
    );
  }
  const dup = (await tx.execute(sql`
    SELECT serial_no FROM public.instruments
    WHERE company_id = ${companyId}::uuid AND item_id = ${cur.itemId}::uuid
      AND deleted_at IS NULL AND id <> ${cur.id}::uuid AND lower(serial_no) = lower(${newSerial})
  `)) as unknown as Array<{ serial_no: string }>;
  if (dup[0]) {
    throw new ConflictError(
      `${code}: Instrument Serial No. ${dup[0].serial_no} is already registered (Serial No. is not case-sensitive).`,
    );
  }
}

export async function createInstrument(
  input: CreateInstrumentInput,
  user: AuthContext,
): Promise<InstrumentListItem> {
  await requireFormAccess(user, FORM, 'entry');
  const companyId = requireCompany(user);
  const serialNo = input.serialNo.trim();
  if (input.lastCalibratedOn && input.lastCalibratedOn > todayIst()) {
    throw new ValidationError('Last Calibrated On cannot be in the future.');
  }
  return withUserContext(user, async (tx) => {
    const itemRows = (await tx.execute(sql`
      SELECT code, item_type::text AS item_type, track_serial FROM public.items
      WHERE id = ${input.itemId}::uuid AND company_id = ${companyId}::uuid AND deleted_at IS NULL
    `)) as unknown as Array<{ code: string; item_type: string; track_serial: boolean }>;
    const it = itemRows[0];
    if (!it) throw new NotFoundError('Item not found. Please select the Item Code again.');
    if (it.item_type !== 'tool' || !it.track_serial) {
      throw new ValidationError(
        `${it.code} is not a Tool / Instrument tracked by Instrument Serial No. — turn on Track by Instrument Serial No. on the item first.`,
      );
    }
    // The item lock serialises two registrations of the same item (P35).
    await lockItemForStock(tx, companyId, input.itemId);
    const dup = (await tx.execute(sql`
      SELECT serial_no FROM public.instruments
      WHERE company_id = ${companyId}::uuid AND item_id = ${input.itemId}::uuid
        AND deleted_at IS NULL AND lower(serial_no) = lower(${serialNo})
    `)) as unknown as Array<{ serial_no: string }>;
    if (dup[0]) {
      throw new ConflictError(
        `${it.code}: Instrument Serial No. ${dup[0].serial_no} is already registered (Instrument Serial No. is not case-sensitive).`,
      );
    }
    const onHand = roundQty((await readStockPosition(tx, companyId, input.itemId)).physicalQty);
    const registered = await countInstrumentsInStore(tx, companyId, input.itemId);
    if (registered + 1 > onHand) {
      throw new ConflictError(
        `${it.code}: all ${onHand} received pieces are registered — receive the new one first (GRN or Stock Count).`,
      );
    }
    const interval = input.calibrationIntervalDays ?? null;
    const due =
      input.calibrationDueOn ??
      (input.lastCalibratedOn && interval ? addDays(input.lastCalibratedOn, interval) : null);
    const ins = await tx
      .insert(instruments)
      .values({
        companyId,
        itemId: input.itemId,
        serialNo,
        status: 'in_store',
        calibrationIntervalDays: interval,
        lastCalibratedOn: input.lastCalibratedOn ?? null,
        calibrationDueOn: due,
        location: input.location?.trim() || null,
        remarks: input.remarks?.trim() || null,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning({ id: instruments.id });
    const id = ins[0]!.id;
    await log(
      tx,
      companyId,
      user,
      'CREATE',
      `${it.code} · Instrument Serial No. ${serialNo} registered${due ? ` · Calibration Due ${due}` : ''}`,
      `${it.code}/${serialNo}`,
    );
    return readInstrument(tx, companyId, id);
  });
}

export async function updateInstrument(
  id: string,
  input: UpdateInstrumentInput,
  user: AuthContext,
): Promise<InstrumentListItem> {
  // Access check in the public wrapper, not the tx body, so the edit-approval
  // engine's applyEdit can replay an approved edit without re-checking it.
  await requireFormAccess(user, FORM, 'entry');
  return withUserContext(user, (tx) => updateInstrumentTx(tx, id, input, user));
}

/**
 * The body of an Instrument edit, inside a caller-supplied transaction. Called by
 * updateInstrument (which opens the tx) and by the edit-approval engine's
 * applyEdit (which already holds the row lock — lockInstrument re-locks the same
 * row in the same tx, which is a no-op). Every guard is preserved verbatim: the
 * FOR UPDATE lock, the Serial-No. edit rule and the free-text EDIT log.
 */
export async function updateInstrumentTx(
  tx: DbTransaction,
  id: string,
  input: UpdateInstrumentInput,
  user: AuthContext,
): Promise<InstrumentListItem> {
  const companyId = requireCompany(user);
  const cur = await lockInstrument(tx, companyId, id);
  const set: Partial<typeof instruments.$inferInsert> = {
    updatedAt: new Date(),
    updatedBy: user.id,
  };
  const code = await itemCodeOf(tx, cur.itemId);
  const newSerial = input.serialNo?.trim();
  const renamed = newSerial !== undefined && newSerial !== cur.serialNo;
  if (renamed) {
    await assertSerialEditable(tx, companyId, cur, code, newSerial);
    set.serialNo = newSerial;
  }
  if (input.calibrationIntervalDays !== undefined) {
    set.calibrationIntervalDays = input.calibrationIntervalDays;
  }
  if (input.location !== undefined) set.location = input.location?.trim() || null;
  if (input.remarks !== undefined) set.remarks = input.remarks?.trim() || null;
  await tx.update(instruments).set(set).where(eq(instruments.id, id));
  const serialNow = renamed ? newSerial : cur.serialNo;
  await log(
    tx,
    companyId,
    user,
    'EDIT',
    `${code} · Instrument Serial No. ${renamed ? `${cur.serialNo} → ${newSerial}` : cur.serialNo}`,
    `${code}/${serialNow}`,
  );
  return readInstrument(tx, companyId, id);
}

/**
 * The Instrument edit entry point the HTTP route calls. Edit-approval (ADR-202):
 * when the company gate is on and the instrument is still live (not in Trash),
 * the edit is STAGED for approval and a {staged:true, request} result is
 * returned; otherwise it falls through to updateInstrument (today's behaviour).
 * An instrument is a single record with no child lines — there is no line guard.
 */
export async function updateInstrumentOrStage(
  id: string,
  input: UpdateInstrumentInput,
  user: AuthContext,
): Promise<InstrumentListItem | DocumentEditStagedResult> {
  await requireFormAccess(user, FORM, 'entry');
  const companyId = requireCompany(user);

  // Imported dynamically to avoid a static import cycle with the registry entry
  // (which imports updateInstrumentTx from this file).
  const { isDocEditApprovalOn, requestDocumentEdit } = await import('../document-edits/service');
  const shouldStage = await withUserContext(user, async (tx) => {
    if (!(await isDocEditApprovalOn(tx, companyId))) return false;
    // "Editable" mirrors the registry's isLive: any live (not-Trash) instrument.
    const rows = await tx
      .select({ id: instruments.id })
      .from(instruments)
      .where(
        and(
          eq(instruments.id, id),
          eq(instruments.companyId, companyId),
          isNull(instruments.deletedAt),
        ),
      )
      .limit(1);
    return rows.length > 0;
  });
  if (shouldStage) {
    // No expectedUpdatedAt token — concurrency is the engine's (loadForDiff
    // locks FOR UPDATE and rechecks field freshness).
    const request = await requestDocumentEdit('Instrument', id, input, undefined, user);
    return { staged: true, request };
  }

  return updateInstrument(id, input, user);
}

export async function sendForCalibration(
  id: string,
  input: SendForCalibrationInput,
  user: AuthContext,
): Promise<InstrumentListItem> {
  await requireFormAccess(user, FORM, 'entry');
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const cur = await lockInstrument(tx, companyId, id);
    if (cur.status !== 'in_store') {
      throw new ConflictError(
        `Instrument Serial No. ${cur.serialNo} is ${INSTRUMENT_STATUS_LABELS[cur.status]} — only an In Store instrument can be sent for calibration.`,
      );
    }
    if (cur.writeoffPending) {
      throw new ConflictError(
        `Instrument Serial No. ${cur.serialNo} has a write-off waiting for a decision — decide it first.`,
      );
    }
    await tx
      .update(instruments)
      .set({ status: 'at_calibration', updatedAt: new Date(), updatedBy: user.id })
      .where(eq(instruments.id, id));
    const code = await itemCodeOf(tx, cur.itemId);
    await log(
      tx,
      companyId,
      user,
      'CALIBRATION OUT',
      `${code} · Instrument Serial No. ${cur.serialNo} sent on ${input.sentOn} to ${input.agency}`,
      `${code}/${cur.serialNo}`,
    );
    return readInstrument(tx, companyId, id);
  });
}

export async function recordCalibration(
  id: string,
  input: RecordCalibrationInput,
  user: AuthContext,
): Promise<InstrumentListItem> {
  await requireFormAccess(user, FORM, 'entry');
  const companyId = requireCompany(user);
  if (input.calibratedOn > todayIst()) {
    throw new ValidationError('Calibrated On cannot be in the future.');
  }
  if (input.nextDueOn && input.nextDueOn <= input.calibratedOn) {
    throw new ValidationError('Next Due On must be after the Calibrated On date.');
  }
  return withUserContext(user, async (tx) => {
    const cur = await lockInstrument(tx, companyId, id);
    if (cur.status !== 'in_store' && cur.status !== 'at_calibration') {
      throw new ConflictError(
        `Instrument Serial No. ${cur.serialNo} is ${INSTRUMENT_STATUS_LABELS[cur.status]} — only an In Store or At Calibration instrument can be calibrated.`,
      );
    }
    const pass = input.result === 'pass';
    const interval = cur.calibrationIntervalDays;
    // P41: a Fail is due at once — it cannot be issued until a Pass or a Scrap.
    const due = pass
      ? (input.nextDueOn ?? (interval ? addDays(input.calibratedOn, interval) : null))
      : input.calibratedOn;
    await tx.insert(instrumentCalibrations).values({
      companyId,
      instrumentId: id,
      calibratedOn: input.calibratedOn,
      result: input.result,
      certificateNo: input.certificateNo?.trim() || null,
      agency: input.agency?.trim() || null,
      nextDueOn: pass ? due : null,
      remarks: input.remarks?.trim() || null,
      createdBy: user.id,
      updatedBy: user.id,
    });
    await tx
      .update(instruments)
      .set({
        status: 'in_store',
        ...(pass ? { lastCalibratedOn: input.calibratedOn } : {}),
        calibrationDueOn: due,
        updatedAt: new Date(),
        updatedBy: user.id,
      })
      .where(eq(instruments.id, id));
    const code = await itemCodeOf(tx, cur.itemId);
    await log(
      tx,
      companyId,
      user,
      'CALIBRATE',
      `${code} · Instrument Serial No. ${cur.serialNo} · ${pass ? 'Pass' : 'Fail'} on ${input.calibratedOn}${due ? ` · Calibration Due ${due}` : ''}${input.certificateNo ? ` · Cert ${input.certificateNo}` : ''}`,
      `${code}/${cur.serialNo}`,
    );
    return readInstrument(tx, companyId, id);
  });
}

/** In Store only, nothing already waiting → a pending write-off of this piece. */
async function requestInstrumentWriteoff(
  id: string,
  kind: 'scrap' | 'lost',
  reason: string,
  user: AuthContext,
): Promise<{ writeoffId: string }> {
  await requireFormAccess(user, FORM, 'entry');
  const companyId = requireCompany(user);
  const verb = kind === 'scrap' ? 'scrapped' : 'marked missing';
  return withUserContext(user, async (tx) => {
    const cur = await lockInstrument(tx, companyId, id);
    if (cur.status !== 'in_store') {
      throw new ConflictError(
        `Instrument Serial No. ${cur.serialNo} is ${INSTRUMENT_STATUS_LABELS[cur.status]} — only an In Store instrument can be ${verb}.`,
      );
    }
    if (cur.writeoffPending) {
      throw new ConflictError(
        `Instrument Serial No. ${cur.serialNo} already has a write-off waiting for a decision.`,
      );
    }
    const ins = await tx
      .insert(toolWriteoffs)
      .values({
        companyId,
        itemId: cur.itemId,
        instrumentId: id,
        kind,
        qty: 1,
        reason,
        status: 'pending',
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning({ id: toolWriteoffs.id });
    const code = await itemCodeOf(tx, cur.itemId);
    await log(
      tx,
      companyId,
      user,
      kind === 'scrap' ? 'SCRAP REQUEST' : 'MISSING REQUEST',
      `${code} · Instrument Serial No. ${cur.serialNo} · ${reason}`,
      `${code}/${cur.serialNo}`,
    );
    return { writeoffId: ins[0]!.id };
  });
}

export async function requestScrap(
  id: string,
  input: ScrapInstrumentInput,
  user: AuthContext,
): Promise<{ writeoffId: string }> {
  return requestInstrumentWriteoff(id, 'scrap', input.reason, user);
}

/** A piece not found on the shelf (e.g. before a Stock Count): a pending
 *  'lost' write-off with no Tool Issue. Approval marks it Lost and takes it
 *  out of stock ('tool_writeoff' out), like a Scrap. */
export async function markMissing(
  id: string,
  input: MarkMissingInstrumentInput,
  user: AuthContext,
): Promise<{ writeoffId: string }> {
  return requestInstrumentWriteoff(id, 'lost', input.reason, user);
}
