// Tool Issue — create (ADR-193 phase 4b, spec §14). toolissue_create 'entry'.
//
// A Tool / Instrument goes out to an Operator (or a typed name), optionally
// against a Job Card. Bulk tools go by Qty; serial tools by picking register
// rows (P37). Order under the locks:
//   1. lock the item, then the instruments in id order (P42)
//   2. each instrument: this item, In Store, no pending write-off (P43),
//      calibration not past the Issue Date (P16)
//   3. header + instruments marked Issued + links — BEFORE the stock move, so
//      the serial cover (In Store + At Calibration ≤ On Hand) holds after it
//   4. ONE ledger 'out' through postStockMove (Available guard)
// Numbering: TIS-NNNNN under a per-company advisory lock (live series kept).

import type { CreateToolIssueInput, ToolIssueDetail } from '@innovic/shared';
import { ActivityAction, INSTRUMENT_STATUS_LABELS } from '@innovic/shared';
import { eq, sql } from 'drizzle-orm';
import { toolIssueInstruments, toolIssues } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { lockItemForStock, postStockMove, roundQty } from '../../lib/stock-ledger';
import { emitActivityLog } from '../activity-log/service';
import { lockInstruments, setInstrumentStatus } from '../instruments/common';
import { requireCompany, todayIst } from './common';
import { readToolIssueDetail } from './read';

const CODE_PREFIX = 'TIS-';
const CODE_PAD = 5;

async function nextToolIssueCode(tx: DbTransaction, companyId: string): Promise<string> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'tool_issue_code:' + companyId}))`);
  const rows = (await tx.execute(sql`
    SELECT COALESCE(MAX(NULLIF(regexp_replace(code, ${'^' + CODE_PREFIX}, ''), '')::int), 0) + 1 AS n
    FROM public.tool_issues
    WHERE company_id = ${companyId}::uuid AND code ~ ${'^' + CODE_PREFIX + '\\d+$'}
  `)) as unknown as Array<{ n: number }>;
  return `${CODE_PREFIX}${String(Number(rows[0]?.n ?? 1)).padStart(CODE_PAD, '0')}`;
}

/** Who received it: an active Operator of this company, else the typed name. */
async function resolveHolder(
  tx: DbTransaction,
  companyId: string,
  input: CreateToolIssueInput,
): Promise<{ operatorId: string | null; issuedTo: string }> {
  if (input.operatorId) {
    const rows = (await tx.execute(sql`
      SELECT id, name FROM public.operators
      WHERE id = ${input.operatorId}::uuid AND company_id = ${companyId}::uuid
        AND is_active = true AND deleted_at IS NULL
    `)) as unknown as Array<{ id: string; name: string }>;
    const op = rows[0];
    if (!op) throw new ValidationError('Pick an active Operator (the one chosen was not found).');
    return { operatorId: op.id, issuedTo: op.name };
  }
  const typed = input.issuedToText?.trim() ?? '';
  if (!typed) throw new ValidationError('Pick who received it (Operator) or type a name');
  return { operatorId: null, issuedTo: typed };
}

async function checkJobCard(tx: DbTransaction, companyId: string, id?: string): Promise<string> {
  if (!id) return '';
  const rows = (await tx.execute(sql`
    SELECT code FROM public.job_cards
    WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid AND deleted_at IS NULL
  `)) as unknown as Array<{ code: string }>;
  if (!rows[0]) throw new ValidationError('The Job Card chosen was not found. Pick it again.');
  return rows[0].code;
}

export async function createToolIssue(
  input: CreateToolIssueInput,
  user: AuthContext,
): Promise<ToolIssueDetail> {
  await requireFormAccess(user, 'toolissue_create', 'entry');
  const companyId = requireCompany(user);
  const userId = user.id;
  if (input.issueDate > todayIst()) throw new ValidationError('Issue Date cannot be in the future');

  return withUserContext(user, async (tx) => {
    const itemRows = (await tx.execute(sql`
      SELECT id, code, name, item_type::text AS item_type, track_serial FROM public.items
      WHERE id = ${input.itemId}::uuid AND company_id = ${companyId}::uuid AND deleted_at IS NULL
    `)) as unknown as Array<{
      id: string;
      code: string;
      name: string;
      item_type: string;
      track_serial: boolean;
    }>;
    const itm = itemRows[0];
    if (!itm)
      throw new NotFoundError('Selected Item was not found. Please select the Item Code again.');
    if (itm.item_type !== 'tool') {
      throw new ValidationError(
        `${itm.code} is not a Tool / Instrument — issue it from the Item Issue register`,
      );
    }
    const serial = Boolean(itm.track_serial);
    if (serial && !input.instrumentIds) {
      throw new ValidationError(
        `${itm.code} is tracked by Instrument Serial No. — pick the instruments to issue, not a Qty`,
      );
    }
    if (!serial && input.instrumentIds) {
      throw new ValidationError(
        `${itm.code} is not tracked by Instrument Serial No. — enter the Issue Qty`,
      );
    }
    const holder = await resolveHolder(tx, companyId, input);
    const jcCode = await checkJobCard(tx, companyId, input.jobCardId);

    await lockItemForStock(tx, companyId, itm.id);
    const picked = await lockInstruments(tx, companyId, input.instrumentIds ?? []);
    const bad = (why: (p: (typeof picked)[number]) => boolean) =>
      picked.filter(why).map((p) => p.serialNo);
    const notThis = bad((p) => p.itemId !== itm.id);
    if (notThis.length) {
      throw new ValidationError(
        `Instrument Serial No. ${notThis.join(', ')} is not a ${itm.code} instrument.`,
      );
    }
    const notIn = picked.filter((p) => p.status !== 'in_store');
    if (notIn.length) {
      throw new ConflictError(
        `Not In Store: ${notIn.map((p) => `${p.serialNo} (${INSTRUMENT_STATUS_LABELS[p.status]})`).join(', ')} — only an In Store instrument can be issued.`,
      );
    }
    const pending = bad((p) => p.writeoffPending);
    if (pending.length) {
      throw new ConflictError(
        `Instrument Serial No. ${pending.join(', ')} has a write-off waiting for a decision — it cannot be issued.`,
      );
    }
    // P41: a failed calibration blocks issue even on the day it failed.
    const failed = bad((p) => p.lastCalibrationFailed);
    if (failed.length) {
      throw new ConflictError(
        `Instrument Serial No. ${failed.join(', ')} failed its last calibration — record a Pass or scrap it before issuing.`,
      );
    }
    // Against the LATER of Issue Date and today: back-dating the issue cannot
    // slip an instrument that is overdue today past the check.
    const today = todayIst();
    const checkOn = input.issueDate > today ? input.issueDate : today;
    const due = picked.filter((p) => p.calibrationDueOn !== null && p.calibrationDueOn < checkOn);
    if (due.length) {
      throw new ConflictError(
        `Calibration overdue: ${due.map((p) => `${p.serialNo} (due ${p.calibrationDueOn})`).join(', ')} — calibrate it before issuing.`,
      );
    }
    const qty = serial ? picked.length : roundQty(input.qty ?? 0);

    const code = await nextToolIssueCode(tx, companyId);
    const inserted = await tx
      .insert(toolIssues)
      .values({
        companyId,
        code,
        issueDate: input.issueDate,
        expectedReturnDate: input.expectedReturnDate,
        itemId: itm.id,
        itemCodeText: itm.code,
        itemName: itm.name,
        qty,
        issuedTo: holder.issuedTo,
        issuedToOperatorId: holder.operatorId,
        jobCardId: input.jobCardId ?? null,
        purpose: input.purpose.trim(),
        remarks: input.remarks?.trim() || null,
        returnStatus: 'issued',
        createdBy: userId,
        updatedBy: userId,
      })
      .returning({ id: toolIssues.id });
    const id = inserted[0]!.id;

    if (picked.length) {
      await setInstrumentStatus(
        tx,
        picked.map((p) => p.id),
        'issued',
        userId,
      );
      await tx.insert(toolIssueInstruments).values(
        picked.map((p) => ({
          companyId,
          toolIssueId: id,
          instrumentId: p.id,
          createdBy: userId,
          updatedBy: userId,
        })),
      );
    }
    const serials = picked.map((p) => p.serialNo).join(', ');
    const moved = await postStockMove(tx, {
      companyId,
      itemId: itm.id,
      txnType: 'out',
      qty,
      sourceType: 'tool_issue',
      sourceRef: `${code} · ${itm.code}`,
      remarks: `Tool Issue · to ${holder.issuedTo}${serials ? ` · ${serials}` : ''}${jcCode ? ` · ${jcCode}` : ''} (Returnable)`,
      txnDate: input.issueDate,
      userId,
      itemCodeText: itm.code,
      guard: 'available',
      qtyLabel: 'Issue Qty',
    });
    await tx.update(toolIssues).set({ storeTransactionId: moved.id }).where(eq(toolIssues.id, id));

    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Issue,
        entity: 'ToolIssue',
        entityId: id,
        refId: code,
        qty,
        operatorName: holder.issuedTo,
        detail: `${code} · ${itm.code} × ${qty}${serials ? ` (${serials})` : ''} → ${holder.issuedTo}${jcCode ? ` · ${jcCode}` : ''}`,
      },
      companyId,
      user,
    );
    return readToolIssueDetail(tx, companyId, id);
  });
}
