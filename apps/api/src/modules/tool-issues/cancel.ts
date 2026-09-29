// Tool Issue — cancel (ADR-193 phase 4b). toolissue_create 'edit'.
//
// Only while nothing was returned (I12): the whole qty goes back to stock with
// an opposite ledger entry ('in', tool_return, "<TIS> cancel") — ADR-189,
// never an edit of the 'out' — and every instrument goes back In Store.

import { ActivityAction, type CancelToolIssueInput, type ToolIssueDetail } from '@innovic/shared';
import { eq, sql } from 'drizzle-orm';
import { toolIssueInstruments, toolIssues } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { ConflictError } from '../../lib/errors';
import { lockItemForStock, postStockMove } from '../../lib/stock-ledger';
import { emitActivityLog } from '../activity-log/service';
import { lockInstruments, setInstrumentStatus } from '../instruments/common';
import { lockIssue, requireCompany, todayIst } from './common';
import { readToolIssueDetail } from './read';

export async function cancelToolIssue(
  id: string,
  input: CancelToolIssueInput,
  user: AuthContext,
): Promise<ToolIssueDetail> {
  await requireFormAccess(user, 'toolissue_create', 'edit');
  const companyId = requireCompany(user);
  const userId = user.id;
  return withUserContext(user, async (tx) => {
    const ti = await lockIssue(tx, companyId, id);
    if (ti.returnStatus === 'cancelled')
      throw new ConflictError(`${ti.code} is already cancelled.`);
    const anyReturn = (await tx.execute(sql`
      SELECT 1 FROM public.tool_issue_returns
      WHERE tool_issue_id = ${id}::uuid AND deleted_at IS NULL
      UNION ALL
      SELECT 1 FROM public.tool_writeoffs
      WHERE tool_issue_id = ${id}::uuid AND deleted_at IS NULL
      LIMIT 1
    `)) as unknown as unknown[];
    if (anyReturn.length > 0) {
      throw new ConflictError(
        `${ti.code} has a return recorded — it can no longer be cancelled. Record the rest as a return instead.`,
      );
    }
    if (!ti.itemId)
      throw new ConflictError(`${ti.code}: the item was deleted — it cannot be cancelled.`);

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
      remarks: `Tool Issue cancelled · ${input.reason}`,
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
    await tx
      .update(toolIssues)
      .set({
        returnStatus: 'cancelled',
        cancelledAt: now,
        cancelledBy: userId,
        cancelReason: input.reason,
        updatedAt: now,
        updatedBy: userId,
      })
      .where(eq(toolIssues.id, id));
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Cancel,
        entity: 'ToolIssue',
        entityId: id,
        refId: ti.code,
        qty,
        reason: input.reason,
        detail: `${ti.code} · ${item.code} × ${qty} back to stock`,
      },
      companyId,
      user,
    );
    return readToolIssueDetail(tx, companyId, id);
  });
}
