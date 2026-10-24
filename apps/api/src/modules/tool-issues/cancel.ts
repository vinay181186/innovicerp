// Tool Issue — cancel (ADR-193 phase 4b; ADR-235: only via an approved Cancel
// Request — the Cancel Request checks the toolissue_create Edit / Approve ticks).
//
// Only while nothing was returned (I12): the whole qty goes back to stock with
// an opposite ledger entry ('in', tool_return, "<TIS> cancel") — ADR-189,
// never an edit of the 'out' — and every instrument goes back In Store.

import { ActivityAction, type CancelBlocker } from '@innovic/shared';
import { and, eq, sql } from 'drizzle-orm';
import { toolIssueInstruments, toolIssues } from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { ConflictError, NotFoundError } from '../../lib/errors';
import { assertRowUpdated } from '../../lib/row-lock';
import { lockItemForStock, postStockMove, roundQty } from '../../lib/stock-ledger';
import { emitActivityLog } from '../activity-log/service';
import { blockerRefusal } from '../cancel-requests/messages';
import { lockInstruments, setInstrumentStatus } from '../instruments/common';
import { todayIst } from './common';

export interface ToolIssueForCancel {
  id: string;
  code: string;
  itemId: string | null;
  itemCode: string | null;
  qty: number;
  returnStatus: string;
}

/** Read the issue header; `forUpdate` locks it (request / approve), the
 *  preview reads without a lock. null = not found in this company. */
export async function lockToolIssueForCancel(
  tx: DbTransaction,
  companyId: string,
  id: string,
  forUpdate: boolean,
): Promise<ToolIssueForCancel | null> {
  const rows = (await tx.execute(sql`
    SELECT ti.id, ti.code, ti.item_id AS "itemId",
      COALESCE(i.code, ti.item_code_text) AS "itemCode",
      ti.qty::float8 AS qty, ti.return_status AS "returnStatus"
    FROM public.tool_issues ti
    LEFT JOIN public.items i ON i.id = ti.item_id
    WHERE ti.id = ${id}::uuid AND ti.company_id = ${companyId}::uuid AND ti.deleted_at IS NULL
    ${forUpdate ? sql`FOR UPDATE OF ti` : sql``}
  `)) as unknown as ToolIssueForCancel[];
  const r = rows[0];
  return r ? { ...r, qty: roundQty(Number(r.qty)) } : null;
}

/**
 * THE Tool Issue cancel refusal rule (worker + preview): a Return or a
 * write-off recorded against it (record the rest as a return instead), or the
 * item deleted (nothing to put the qty back on).
 */
export async function toolIssueCancelBlockers(
  tx: DbTransaction,
  companyId: string,
  id: string,
): Promise<CancelBlocker[]> {
  const ti = await lockToolIssueForCancel(tx, companyId, id, false);
  if (!ti) return [];
  const out: CancelBlocker[] = [];
  const done = (await tx.execute(sql`
    SELECT
      (SELECT COALESCE(SUM(good_qty + damaged_qty + lost_qty + consumed_qty), 0)::float8 FROM public.tool_issue_returns
        WHERE tool_issue_id = ${id}::uuid AND deleted_at IS NULL) AS returned,
      (SELECT COUNT(*)::int FROM public.tool_issue_returns
        WHERE tool_issue_id = ${id}::uuid AND deleted_at IS NULL) AS "returnRows",
      (SELECT COUNT(*)::int FROM public.tool_writeoffs
        WHERE tool_issue_id = ${id}::uuid AND deleted_at IS NULL) AS writeoffs
  `)) as unknown as Array<{ returned: number; returnRows: number; writeoffs: number }>;
  const d = done[0];
  if (d && Number(d.returnRows) > 0) {
    out.push({
      docLabel: 'Tool Return',
      docNo: ti.code,
      href: null,
      reason: `${roundQty(Number(d.returned))} already returned — record the rest as a return instead`,
    });
  }
  if (d && Number(d.writeoffs) > 0) {
    out.push({
      docLabel: 'Tool Write-off',
      docNo: ti.code,
      href: null,
      reason: `${Number(d.writeoffs)} write-off(s) recorded — record the rest as a return instead`,
    });
  }
  if (!ti.itemId) {
    out.push({
      docLabel: 'Item',
      docNo: ti.itemCode ?? ti.code,
      href: null,
      reason: 'the item was deleted — there is nothing to put the qty back on',
    });
  }
  return out;
}

/** The ONE Tool Issue cancel writer (ADR-235). In-tx, no rights check. */
export async function cancelToolIssueTx(
  tx: DbTransaction,
  companyId: string,
  id: string,
  reason: string,
  user: AuthContext,
): Promise<void> {
  const userId = user.id;
  const ti = await lockToolIssueForCancel(tx, companyId, id, true);
  if (!ti) throw new NotFoundError('Tool Issue not found. Refresh the page.');
  if (ti.returnStatus === 'cancelled') throw new ConflictError(`${ti.code} is already cancelled.`);
  const blockers = await toolIssueCancelBlockers(tx, companyId, id);
  if (blockers.length > 0 || !ti.itemId) {
    throw new ConflictError(blockerRefusal(ti.code, blockers), { blockers });
  }

  const item = await lockItemForStock(tx, companyId, ti.itemId);
  const links = (await tx.execute(sql`
    SELECT instrument_id FROM public.tool_issue_instruments
    WHERE tool_issue_id = ${id}::uuid AND deleted_at IS NULL
  `)) as unknown as Array<{ instrument_id: string }>;
  const locked = await lockInstruments(
    tx,
    companyId,
    links.map((l) => l.instrument_id),
  );
  const qty = locked.length > 0 ? locked.length : ti.qty;
  const today = todayIst();

  await postStockMove(tx, {
    companyId,
    itemId: ti.itemId,
    txnType: 'in',
    qty,
    sourceType: 'tool_return',
    sourceRef: `${ti.code} cancel`,
    remarks: `Tool Issue cancelled · ${reason}`,
    txnDate: today,
    userId,
    itemCodeText: item.code,
    guard: 'none',
  });
  if (locked.length > 0) {
    await setInstrumentStatus(
      tx,
      locked.map((l) => l.id),
      'in_store',
      userId,
    );
    await tx
      .update(toolIssueInstruments)
      .set({
        returnedOn: today,
        returnCondition: 'good',
        updatedAt: new Date(),
        updatedBy: userId,
      })
      .where(eq(toolIssueInstruments.toolIssueId, id));
  }
  const now = new Date();
  // §20.2 — cancel once: only from the status read under the lock above.
  const moved = await tx
    .update(toolIssues)
    .set({
      returnStatus: 'cancelled',
      cancelledAt: now,
      cancelledBy: userId,
      cancelReason: reason,
      updatedAt: now,
      updatedBy: userId,
    })
    .where(and(eq(toolIssues.id, id), eq(toolIssues.returnStatus, ti.returnStatus)))
    .returning({ id: toolIssues.id });
  assertRowUpdated(moved, ti.code);
  await emitActivityLog(
    tx,
    {
      action: ActivityAction.Cancel,
      entity: 'ToolIssue',
      entityId: id,
      refId: ti.code,
      qty,
      reason,
      detail: `${ti.code} · ${item.code} × ${qty} back to stock`,
    },
    companyId,
    user,
  );
}
