// Tool write-offs (ADR-193 phase 4b). A Damaged / Lost return, or a Scrap of
// an in-store instrument, waits here for the Store In-charge.
//
//   list     store view forms
//   decide   toolissue_create 'approve'; never the person who recorded it (P40)
//
//   approve  Damaged → instrument Scrapped · Lost → instrument Lost — no stock
//            move (it left at issue). Scrap → instrument Scrapped, and Mark
//            Missing (Lost, no Tool Issue) → instrument Lost, THEN one ledger
//            'out' (tool_writeoff) — the only write-offs that move stock.
//   reject   Damaged → back into stock as Good ('in', tool_return), instrument
//            In Store · Lost → still out with the holder (instrument stays
//            Issued and can be returned again) · Scrap → nothing changes.

import {
  ActivityAction,
  type DecideToolWriteoffInput,
  type ListToolWriteoffsQuery,
  type ListToolWriteoffsResponse,
  type ToolWriteoffKind,
  type ToolWriteoffRow,
  type ToolWriteoffStatus,
} from '@innovic/shared';
import { and, eq, sql } from 'drizzle-orm';
import { toolIssueInstruments, toolWriteoffs } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireAnyFormAccess, requireFormAccess, STORE_VIEW_FORMS } from '../../lib/access';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { lockItemForStock, postStockMove, roundQty } from '../../lib/stock-ledger';
import { readSf, sfOrderBy, sfWhere } from '../../lib/list-query';
import { emitActivityLog } from '../activity-log/service';
import { lockInstrument, setInstrumentStatus, tsOut } from '../instruments/common';
import { lockIssue, refreshReturnStatus, requireCompany, todayIst } from './common';
import { TOOL_WRITEOFF_SF_COLUMNS } from './writeoff-sf-columns';

const SELECT = sql`
  SELECT w.id, w.kind, w.status, w.item_id, i.code AS item_code, i.name AS item_name,
         w.instrument_id, ins.serial_no, w.tool_issue_id, ti.code AS tool_issue_code,
         ti.issued_to AS holder, w.qty, w.reason, ru.full_name AS requested_by_name,
         w.created_at, w.created_by, du.full_name AS decided_by_name, w.decided_at,
         w.decision_remarks
  FROM public.tool_writeoffs w
  JOIN public.items i ON i.id = w.item_id
  LEFT JOIN public.instruments ins ON ins.id = w.instrument_id
  LEFT JOIN public.tool_issues ti ON ti.id = w.tool_issue_id
  LEFT JOIN public.users ru ON ru.id = w.created_by
  LEFT JOIN public.users du ON du.id = w.decided_by`;

function toRow(r: Record<string, unknown>): ToolWriteoffRow {
  return {
    id: String(r['id']),
    kind: r['kind'] as ToolWriteoffKind,
    status: r['status'] as ToolWriteoffStatus,
    itemId: String(r['item_id']),
    itemCode: String(r['item_code'] ?? ''),
    itemName: (r['item_name'] as string | null) ?? null,
    instrumentId: (r['instrument_id'] as string | null) ?? null,
    serialNo: (r['serial_no'] as string | null) ?? null,
    toolIssueId: (r['tool_issue_id'] as string | null) ?? null,
    toolIssueCode: (r['tool_issue_code'] as string | null) ?? null,
    holder: (r['holder'] as string | null) ?? null,
    qty: roundQty(Number(r['qty'] ?? 0)),
    reason: String(r['reason'] ?? ''),
    requestedByName: (r['requested_by_name'] as string | null) ?? null,
    requestedAt: tsOut(r['created_at']),
    requestedBy: String(r['created_by']),
    decidedByName: (r['decided_by_name'] as string | null) ?? null,
    decidedAt: r['decided_at'] != null ? tsOut(r['decided_at']) : null,
    decisionRemarks: (r['decision_remarks'] as string | null) ?? null,
  };
}

async function readWriteoff(tx: DbTransaction, companyId: string, id: string) {
  const rows = (await tx.execute(sql`
    ${SELECT}
    WHERE w.id = ${id}::uuid AND w.company_id = ${companyId}::uuid AND w.deleted_at IS NULL
  `)) as unknown as Array<Record<string, unknown>>;
  if (!rows[0]) throw new NotFoundError('Write-off not found. Refresh the page.');
  return toRow(rows[0]);
}

export async function listToolWriteoffs(
  q: ListToolWriteoffsQuery,
  user: AuthContext,
): Promise<ListToolWriteoffsResponse> {
  await requireAnyFormAccess(user, STORE_VIEW_FORMS);
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    // Sort & Filter (ADR-200) over the SELECT's joins — the count wraps the
    // same select, so the total follows every filter.
    const sf = readSf(q.sf);
    const where = sql`w.company_id = ${companyId}::uuid AND w.deleted_at IS NULL
      ${q.status ? sql`AND w.status = ${q.status}` : sql``}
      ${sfWhere(TOOL_WRITEOFF_SF_COLUMNS, sf)}`;
    // Pending first, newest first, id last — a unique tie-breaker so paging
    // never skips or repeats a row.
    const order = sfOrderBy(
      TOOL_WRITEOFF_SF_COLUMNS,
      sf,
      sql`(w.status = 'pending') DESC, w.created_at DESC, w.id DESC`,
    );
    const rows = (await tx.execute(sql`
      ${SELECT}
      WHERE ${where}
      ORDER BY ${order}
      LIMIT ${q.limit} OFFSET ${q.offset}
    `)) as unknown as Array<Record<string, unknown>>;
    const totals = (await tx.execute(sql`
      SELECT COUNT(*)::int AS total FROM (${SELECT} WHERE ${where}) z
    `)) as unknown as Array<{ total: number }>;
    return { items: rows.map(toRow), total: Number(totals[0]?.total ?? 0) };
  });
}

export async function decideToolWriteoff(
  id: string,
  input: DecideToolWriteoffInput,
  user: AuthContext,
): Promise<ToolWriteoffRow> {
  await requireFormAccess(user, 'toolissue_create', 'approve');
  const companyId = requireCompany(user);
  const userId = user.id;
  return withUserContext(user, async (tx) => {
    const locked = (await tx.execute(sql`
      SELECT id FROM public.tool_writeoffs
      WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid AND deleted_at IS NULL
      FOR UPDATE
    `)) as unknown as unknown[];
    if (locked.length === 0) throw new NotFoundError('Write-off not found. Refresh the page.');
    const w = await readWriteoff(tx, companyId, id);
    if (w.status !== 'pending') throw new ConflictError(`This write-off is already ${w.status}.`);
    if (w.requestedBy === userId) {
      throw new AuthorizationError(
        'You recorded this write-off, so you cannot decide it yourself. Someone else with approve rights has to.',
      );
    }
    const approve = input.decision === 'approve';
    // ADR-197 — a Reject needs a reason (the decision Remarks are the reason).
    const decisionRemarks = input.remarks?.trim() || null;
    if (!approve && !decisionRemarks) {
      throw new ValidationError('Give a reason in Remarks to reject this write-off.');
    }
    const ti = w.toolIssueId ? await lockIssue(tx, companyId, w.toolIssueId) : null;
    const item = await lockItemForStock(tx, companyId, w.itemId);
    const ins = w.instrumentId ? await lockInstrument(tx, companyId, w.instrumentId) : null;
    const what = `${item.code}${ins ? ` Instrument Serial No. ${ins.serialNo}` : ` × ${w.qty}`}`;
    let storeTxnId: string | null = null;

    // Scrap, or Mark Missing (a 'lost' with no Tool Issue): the piece is still
    // counted in stock, so approval is the one write-off that moves stock.
    const fromShelf = w.kind === 'scrap' || (w.kind === 'lost' && !w.toolIssueId);
    if (approve && fromShelf) {
      const word = w.kind === 'scrap' ? 'scrapped' : 'marked missing';
      if (!ins || (ins.status !== 'in_store' && ins.status !== 'at_calibration')) {
        throw new ConflictError(`${what} is no longer In Store — it cannot be ${word}.`);
      }
      // Register first, then the 'out' — the serial cover holds after the move.
      await setInstrumentStatus(tx, [ins.id], w.kind === 'scrap' ? 'scrapped' : 'lost', userId);
      const moved = await postStockMove(tx, {
        companyId,
        itemId: w.itemId,
        txnType: 'out',
        qty: 1,
        sourceType: 'tool_writeoff',
        sourceRef: `${item.code} · ${ins.serialNo} ${w.kind === 'scrap' ? 'scrap' : 'missing'}`,
        remarks: `Instrument ${word} · ${w.reason}`,
        txnDate: todayIst(),
        userId,
        itemCodeText: item.code,
        guard: 'on_hand',
      });
      storeTxnId = moved.id;
    } else if (approve && ins) {
      await setInstrumentStatus(tx, [ins.id], w.kind === 'lost' ? 'lost' : 'scrapped', userId);
    } else if (!approve && w.kind === 'damaged') {
      const moved = await postStockMove(tx, {
        companyId,
        itemId: w.itemId,
        txnType: 'in',
        qty: w.qty,
        sourceType: 'tool_return',
        sourceRef: `${ti?.code ?? item.code} · write-off rejected`,
        remarks: `Damaged write-off rejected — back as Good${input.remarks ? ` · ${input.remarks}` : ''}`,
        txnDate: todayIst(),
        userId,
        itemCodeText: item.code,
        guard: 'none',
      });
      storeTxnId = moved.id;
      if (ins && ti) {
        await setInstrumentStatus(tx, [ins.id], 'in_store', userId);
        await updateLink(tx, ti.id, ins.id, 'good', userId);
      }
    } else if (!approve && w.kind === 'lost' && ins && ti) {
      // Still out with the holder: clear the return so it can come back later.
      await updateLink(tx, ti.id, ins.id, null, userId);
    }

    const now = new Date();
    await tx
      .update(toolWriteoffs)
      .set({
        status: approve ? 'approved' : 'rejected',
        decidedBy: userId,
        decidedAt: now,
        decisionRemarks: input.remarks?.trim() || null,
        storeTransactionId: storeTxnId,
        updatedAt: now,
        updatedBy: userId,
      })
      .where(eq(toolWriteoffs.id, id));
    if (ti) await refreshReturnStatus(tx, companyId, ti.id, userId);
    await emitActivityLog(
      tx,
      {
        action: approve ? ActivityAction.Approve : ActivityAction.Reject,
        // The Tool Issue is the document when there is one; a shelf Scrap /
        // Mark Missing has no Tool Issue, so it stays on the write-off itself.
        entity: ti ? 'ToolIssue' : 'Tool Write-off',
        entityId: ti ? ti.id : id,
        refId: ti?.code ?? item.code,
        qty: w.qty,
        reason: approve ? null : decisionRemarks,
        detail: `${w.kind} write-off · ${what}${ti ? ` · ${ti.code}` : ''} · ${approve ? 'approved' : 'rejected'}${approve && decisionRemarks ? ` · ${decisionRemarks}` : ''}`,
      },
      companyId,
      user,
    );
    return readWriteoff(tx, companyId, id);
  });
}

async function updateLink(
  tx: DbTransaction,
  toolIssueId: string,
  instrumentId: string,
  condition: 'good' | null,
  userId: string,
): Promise<void> {
  await tx
    .update(toolIssueInstruments)
    .set({
      returnCondition: condition,
      ...(condition === null ? { returnedOn: null } : {}),
      updatedAt: new Date(),
      updatedBy: userId,
    })
    .where(
      and(
        eq(toolIssueInstruments.toolIssueId, toolIssueId),
        eq(toolIssueInstruments.instrumentId, instrumentId),
      ),
    );
}
