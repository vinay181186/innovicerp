// Tool Issue — returns (ADR-193 phase 4b). toolissue_create 'edit' (recording
// a return changes a saved issue).
//
//   Good      → ledger 'in' (tool_return); a serial instrument goes In Store
//   Consumed  → closes that qty, no stock (bulk only — normal wear)
//   Damaged / Lost → a pending write-off (one per instrument for serial tools);
//               no stock moves until the Store In-charge decides (writeoffs.ts)
// A return can never exceed what is Still Out; a cancelled issue takes none.

import {
  ActivityAction,
  type RecordToolReturnInput,
  type ReturnInstrumentsInput,
  type ToolIssueDetail,
} from '@innovic/shared';
import { and, eq, sql } from 'drizzle-orm';
import { toolIssueInstruments, toolIssueReturns, toolWriteoffs } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { ConflictError, ValidationError } from '../../lib/errors';
import {
  assertQtyFitsUom,
  lockItemForStock,
  postStockMove,
  roundQty,
} from '../../lib/stock-ledger';
import { emitActivityLog } from '../activity-log/service';
import { lockInstruments, setInstrumentStatus } from '../instruments/common';
import { lockIssue, readIssue, refreshReturnStatus, requireCompany, todayIst } from './common';
import { readToolIssueDetail } from './read';

type Issue = Awaited<ReturnType<typeof lockIssue>>;

async function openIssue(
  tx: DbTransaction,
  companyId: string,
  id: string,
  returnDate: string,
): Promise<Issue> {
  if (returnDate > todayIst()) throw new ValidationError('Return Date cannot be in the future');
  const ti = await lockIssue(tx, companyId, id);
  if (returnDate < ti.issueDate) {
    throw new ValidationError(
      `Return Date cannot be before the Issue Date of ${ti.code} (${ti.issueDate})`,
    );
  }
  if (ti.returnStatus === 'cancelled') {
    throw new ConflictError(`${ti.code} is cancelled — nothing can be returned against it.`);
  }
  if (!ti.itemId)
    throw new ConflictError(`${ti.code}: the item was deleted — returns cannot be recorded.`);
  return ti;
}

/** The instrument links of an issue, locked. Empty = a bulk issue. */
async function lockLinks(tx: DbTransaction, issueId: string) {
  return (await tx.execute(sql`
    SELECT id, instrument_id, returned_on FROM public.tool_issue_instruments
    WHERE tool_issue_id = ${issueId}::uuid AND deleted_at IS NULL
    FOR UPDATE
  `)) as unknown as Array<{ id: string; instrument_id: string; returned_on: unknown }>;
}

async function insertWriteoffs(
  tx: DbTransaction,
  rows: Array<{ kind: 'damaged' | 'lost'; qty: number; instrumentId?: string }>,
  base: {
    companyId: string;
    itemId: string;
    toolIssueId: string;
    returnId: string;
    reason: string;
    userId: string;
  },
): Promise<void> {
  if (rows.length === 0) return;
  await tx.insert(toolWriteoffs).values(
    rows.map((r) => ({
      companyId: base.companyId,
      itemId: base.itemId,
      instrumentId: r.instrumentId ?? null,
      toolIssueId: base.toolIssueId,
      toolIssueReturnId: base.returnId,
      kind: r.kind,
      qty: r.qty,
      reason: base.reason,
      status: 'pending',
      createdBy: base.userId,
      updatedBy: base.userId,
    })),
  );
}

export async function recordToolReturn(
  id: string,
  input: RecordToolReturnInput,
  user: AuthContext,
): Promise<ToolIssueDetail> {
  await requireFormAccess(user, 'toolissue_create', 'edit');
  const companyId = requireCompany(user);
  const userId = user.id;
  return withUserContext(user, async (tx) => {
    const ti = await openIssue(tx, companyId, id, input.returnDate);
    if ((await lockLinks(tx, id)).length > 0) {
      throw new ValidationError(
        `${ti.code} went out by Instrument Serial No. — return it instrument by instrument.`,
      );
    }
    const item = await lockItemForStock(tx, companyId, ti.itemId!);
    const parts = {
      Good: roundQty(input.goodQty),
      Damaged: roundQty(input.damagedQty),
      Lost: roundQty(input.lostQty),
      Consumed: roundQty(input.consumedQty),
    };
    for (const [label, v] of Object.entries(parts)) {
      if (v > 0) assertQtyFitsUom(item.code, item.uom, v, `${label} Qty`);
    }
    const total = roundQty(parts.Good + parts.Damaged + parts.Lost + parts.Consumed);
    const cur = await readIssue(tx, companyId, id);
    if (total > cur.stillOutQty) {
      throw new ConflictError(
        `${ti.code}: Return Qty (${total}) cannot be more than Still Out (${cur.stillOutQty}) — only ${cur.stillOutQty} is still out.`,
      );
    }
    const reason = input.reason?.trim() || null;
    const ret = await tx
      .insert(toolIssueReturns)
      .values({
        companyId,
        toolIssueId: id,
        returnDate: input.returnDate,
        goodQty: parts.Good,
        damagedQty: parts.Damaged,
        lostQty: parts.Lost,
        consumedQty: parts.Consumed,
        reason,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning({ id: toolIssueReturns.id });
    const returnId = ret[0]!.id;
    if (parts.Good > 0) {
      const moved = await postStockMove(tx, {
        companyId,
        itemId: ti.itemId!,
        txnType: 'in',
        qty: parts.Good,
        sourceType: 'tool_return',
        sourceRef: `${ti.code} · ${item.code}`,
        remarks: `Tool Return · ${parts.Good} good from ${ti.issuedTo}`,
        txnDate: input.returnDate,
        userId,
        itemCodeText: item.code,
        guard: 'none',
      });
      await tx
        .update(toolIssueReturns)
        .set({ storeTransactionId: moved.id })
        .where(eq(toolIssueReturns.id, returnId));
    }
    const wo: Array<{ kind: 'damaged' | 'lost'; qty: number }> = [];
    if (parts.Damaged > 0) wo.push({ kind: 'damaged', qty: parts.Damaged });
    if (parts.Lost > 0) wo.push({ kind: 'lost', qty: parts.Lost });
    await insertWriteoffs(tx, wo, {
      companyId,
      itemId: ti.itemId!,
      toolIssueId: id,
      returnId,
      reason: reason ?? '',
      userId,
    });
    await refreshReturnStatus(tx, companyId, id, userId);
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Return,
        entity: 'ToolIssue',
        entityId: id,
        refId: ti.code,
        qty: total,
        reason,
        detail: `${ti.code} · good ${parts.Good} · damaged ${parts.Damaged} · lost ${parts.Lost} · consumed ${parts.Consumed}`,
      },
      companyId,
      user,
    );
    return readToolIssueDetail(tx, companyId, id);
  });
}

export async function returnInstruments(
  id: string,
  input: ReturnInstrumentsInput,
  user: AuthContext,
): Promise<ToolIssueDetail> {
  await requireFormAccess(user, 'toolissue_create', 'edit');
  const companyId = requireCompany(user);
  const userId = user.id;
  const ids = input.instruments.map((i) => i.instrumentId);
  if (new Set(ids).size !== ids.length) {
    throw new ValidationError('An instrument is listed twice on this return.');
  }
  return withUserContext(user, async (tx) => {
    const ti = await openIssue(tx, companyId, id, input.returnDate);
    const links = await lockLinks(tx, id);
    if (links.length === 0) {
      throw new ValidationError(
        `${ti.code} is a bulk issue — enter the Good / Damaged / Lost / Consumed qty instead.`,
      );
    }
    const item = await lockItemForStock(tx, companyId, ti.itemId!);
    const locked = await lockInstruments(tx, companyId, ids);
    const serialOf = new Map(locked.map((l) => [l.id, l.serialNo]));
    const linkOf = new Map(links.map((l) => [l.instrument_id, l]));
    const notOn = ids.filter((x) => !linkOf.has(x)).map((x) => serialOf.get(x));
    if (notOn.length) {
      throw new ValidationError(`Instrument Serial No. ${notOn.join(', ')} is not on ${ti.code}.`);
    }
    const again = ids.filter((x) => linkOf.get(x)!.returned_on != null).map((x) => serialOf.get(x));
    if (again.length) {
      throw new ConflictError(
        `Instrument Serial No. ${again.join(', ')} is already returned on ${ti.code}.`,
      );
    }
    const by = (c: string) =>
      input.instruments.filter((i) => i.condition === c).map((i) => i.instrumentId);
    const good = by('good');
    const damaged = by('damaged');
    const lost = by('lost');
    const reason = input.reason?.trim() || null;

    const ret = await tx
      .insert(toolIssueReturns)
      .values({
        companyId,
        toolIssueId: id,
        returnDate: input.returnDate,
        goodQty: good.length,
        damagedQty: damaged.length,
        lostQty: lost.length,
        consumedQty: 0,
        reason,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning({ id: toolIssueReturns.id });
    const returnId = ret[0]!.id;
    if (good.length) {
      const moved = await postStockMove(tx, {
        companyId,
        itemId: ti.itemId!,
        txnType: 'in',
        qty: good.length,
        sourceType: 'tool_return',
        sourceRef: `${ti.code} · ${item.code}`,
        remarks: `Tool Return · ${good.map((x) => serialOf.get(x)).join(', ')} good from ${ti.issuedTo}`,
        txnDate: input.returnDate,
        userId,
        itemCodeText: item.code,
        guard: 'none',
      });
      await tx
        .update(toolIssueReturns)
        .set({ storeTransactionId: moved.id })
        .where(eq(toolIssueReturns.id, returnId));
      await setInstrumentStatus(tx, good, 'in_store', userId);
    }
    for (const i of input.instruments) {
      await tx
        .update(toolIssueInstruments)
        .set({
          returnedOn: input.returnDate,
          returnCondition: i.condition,
          updatedAt: new Date(),
          updatedBy: userId,
        })
        .where(
          and(
            eq(toolIssueInstruments.toolIssueId, id),
            eq(toolIssueInstruments.instrumentId, i.instrumentId),
          ),
        );
    }
    // Damaged / Lost instruments stay Issued until the write-off is decided.
    await insertWriteoffs(
      tx,
      [
        ...damaged.map((x) => ({ kind: 'damaged' as const, qty: 1, instrumentId: x })),
        ...lost.map((x) => ({ kind: 'lost' as const, qty: 1, instrumentId: x })),
      ],
      { companyId, itemId: ti.itemId!, toolIssueId: id, returnId, reason: reason ?? '', userId },
    );
    await refreshReturnStatus(tx, companyId, id, userId);
    const list = (xs: string[]) => xs.map((x) => serialOf.get(x)).join(', ') || '—';
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Return,
        entity: 'ToolIssue',
        entityId: id,
        refId: ti.code,
        qty: input.instruments.length,
        reason,
        detail: `${ti.code} · good ${list(good)} · damaged ${list(damaged)} · lost ${list(lost)}`,
      },
      companyId,
      user,
    );
    return readToolIssueDetail(tx, companyId, id);
  });
}
