// ADR-196 — Close a Sales Order short, per line (ERPNext Sales Order "Close").
//
// ERPNext's Close stops further delivery and billing of an order's remainder
// (status "Closed"; erpnext/selling/doctype/sales_order/sales_order.py
// update_status). Here it is done per SO LINE, copying the JWSO line short
// close exactly (ADR-194 R6): the line's status becomes 'closed' — the shared
// so_status enum is NOT widened — and short_closed_at / _by / short_close_reason
// record that it closed with qty undelivered, who, when and why (migration
// 0177). A reason is required.
//
// What the close drops is the line's undelivered qty, Order Qty − Dispatched:
// it leaves every Pending / to-plan / dispatchable figure, and a linked plan's
// leftover Pending is capped at 0 (lib/plan-order-coverage.ts) so it no longer
// asks for a Production Order. What was dispatched stays, and can still be
// billed — an invoice here always follows a dispatch.
//
// Refused while work is still running for the line — an open Job Card or an
// open / partly closed Production Order — with the documents named, so the
// user stops those first (ERPNext likewise will not close over a running Work
// Order's delivery). Permission is ADR-194's choice: closing with qty unmet is
// a department-admin decision, so it takes the edit AND approve pair on the
// SO's own form key (so_create); no new permission key.
//
// The header "Close" (closeSalesOrder) short-closes every live line that still
// has qty undelivered, with one reason, in one transaction.

import { ActivityAction } from '@innovic/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { salesOrderLines, salesOrders } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { requireWriteRole } from '../../lib/auth';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { reconcileLineReservations } from '../../lib/stock-reservation';
import { emitActivityLog } from '../activity-log/service';
import { assertNoLiveMlPlan } from '../ml-plan/guards';
import { lineLabel, readSoLineCommitments } from './line-commitments';
import type {
  CloseSalesOrderInput,
  SalesOrderDetail,
  ShortCloseSalesOrderLineInput,
} from './schema';
import { getSalesOrder } from './service';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

async function requireClosePermission(user: AuthContext): Promise<void> {
  requireWriteRole(user);
  await requireFormAccess(user, 'so_create', 'edit');
  await requireFormAccess(user, 'so_create', 'approve');
}

/** Work still running for the given SO lines, as readable codes. An open Job
 *  Card is one that is not closed and whose v_jc_status is not complete /
 *  closed; a card whose Production Order already stopped (closed / short
 *  closed, ADR-182) is abandoned or finished work, not running. A Production
 *  Order is running while 'open' or 'partially_closed'. */
async function readRunningWork(
  tx: DbTransaction,
  companyId: string,
  lineIds: string[],
): Promise<Map<string, { jcCodes: string[]; orderCodes: string[] }>> {
  const out = new Map<string, { jcCodes: string[]; orderCodes: string[] }>();
  if (lineIds.length === 0) return out;
  const idList = sql.join(
    lineIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const get = (lineId: string): { jcCodes: string[]; orderCodes: string[] } => {
    let v = out.get(lineId);
    if (!v) {
      v = { jcCodes: [], orderCodes: [] };
      out.set(lineId, v);
    }
    return v;
  };

  const jcRows = (await tx.execute(sql`
    SELECT jc.source_so_line_id AS "lineId", jc.code
    FROM public.job_cards jc
    LEFT JOIN public.v_jc_status cs ON cs.job_card_id = jc.id
    WHERE jc.company_id = ${companyId}::uuid
      AND jc.source_so_line_id IN (${idList})
      AND jc.deleted_at IS NULL
      AND jc.closed_at IS NULL
      AND COALESCE(cs.computed_status, 'no_ops') NOT IN ('complete', 'closed')
      AND NOT EXISTS (
        SELECT 1 FROM public.production_orders po_s
        WHERE po_s.id = jc.production_order_id
          AND po_s.deleted_at IS NULL
          AND po_s.status IN ('closed', 'short_closed')
      )
    ORDER BY jc.code
  `)) as unknown as Array<{ lineId: string; code: string }>;
  for (const r of jcRows) get(r.lineId).jcCodes.push(r.code);

  const poRows = (await tx.execute(sql`
    SELECT p.so_line_id AS "lineId", po.code
    FROM public.production_orders po
    JOIN public.plans p ON p.id = po.plan_id AND p.deleted_at IS NULL
    WHERE po.company_id = ${companyId}::uuid
      AND p.so_line_id IN (${idList})
      AND po.deleted_at IS NULL
      AND po.status IN ('open', 'partially_closed')
    ORDER BY po.code
  `)) as unknown as Array<{ lineId: string; code: string }>;
  for (const r of poRows) get(r.lineId).orderCodes.push(r.code);

  return out;
}

/**
 * Short-close the given lines of one SO inside the caller's transaction.
 * `mode` decides what an ineligible line does: 'line' (the user picked it)
 * refuses; 'header' (Close the whole order) skips lines with nothing left.
 * Returns how many lines were closed.
 */
async function shortCloseLinesTx(
  tx: DbTransaction,
  args: {
    companyId: string;
    salesOrderId: string;
    lineIds: string[];
    reason: string;
    mode: 'line' | 'header';
  },
  user: AuthContext,
): Promise<number> {
  const { companyId, salesOrderId, reason, mode } = args;

  const hdrRows = await tx
    .select({
      code: salesOrders.code,
      internalSoNo: salesOrders.internalSoNo,
      status: salesOrders.status,
    })
    .from(salesOrders)
    .where(
      and(
        eq(salesOrders.id, salesOrderId),
        eq(salesOrders.companyId, companyId),
        isNull(salesOrders.deletedAt),
      ),
    )
    .limit(1);
  const hdr = hdrRows[0];
  if (!hdr) throw new NotFoundError('SO not found. It may have been moved to Trash.');
  // What the user-facing messages call the SO (ADR-207); logs keep the SO No.
  const soLabel = hdr.internalSoNo ? `${hdr.code} · ${hdr.internalSoNo}` : hdr.code;
  if (hdr.status === 'draft' || hdr.status === 'cancelled') {
    throw new ValidationError(
      `${soLabel} is ${hdr.status === 'draft' ? 'a draft' : 'cancelled'} — there is nothing to close.` +
        (hdr.status === 'draft' ? ' Cancel the draft instead.' : ''),
    );
  }

  // Locks the lines FOR UPDATE (as the SO edit guards and plan create do;
  // Production Order create reads the line FOR SHARE, so it waits for this
  // close and then sees it), then reads what hangs off them.
  const commitments = await readSoLineCommitments(tx, companyId, args.lineIds);
  const lineRows = await tx
    .select({
      id: salesOrderLines.id,
      salesOrderId: salesOrderLines.salesOrderId,
      lineNo: salesOrderLines.lineNo,
      orderQty: salesOrderLines.orderQty,
      dispatchedQty: salesOrderLines.dispatchedQty,
      status: salesOrderLines.status,
      shortClosedAt: salesOrderLines.shortClosedAt,
    })
    .from(salesOrderLines)
    .where(
      and(
        inArray(salesOrderLines.id, args.lineIds),
        eq(salesOrderLines.companyId, companyId),
        isNull(salesOrderLines.deletedAt),
      ),
    )
    .orderBy(salesOrderLines.lineNo);

  const eligible: typeof lineRows = [];
  for (const l of lineRows) {
    if (l.salesOrderId !== salesOrderId) {
      throw new ValidationError('That line is not on this SO. Refresh the page.');
    }
    const c = commitments.get(l.id);
    const label = c ? lineLabel(c) : `Line ${l.lineNo}`;
    const undelivered = Math.max(0, l.orderQty - l.dispatchedQty);
    let refusal: string | null = null;
    if (l.shortClosedAt) refusal = `${label} is already closed short.`;
    else if (l.status === 'cancelled')
      refusal = `${label} is cancelled — there is nothing to close.`;
    else if (undelivered === 0)
      refusal = `${label} is fully dispatched — there is nothing left to close.`;
    if (refusal) {
      if (mode === 'line') throw new ConflictError(refusal);
      continue;
    }
    eligible.push(l);
  }
  if (eligible.length === 0) {
    if (mode === 'line') throw new NotFoundError('SO line not found. Refresh the page.');
    throw new ConflictError(
      `${soLabel} has no line left to close — every line is fully dispatched, cancelled or already closed short.`,
    );
  }

  // ADR-225 phase 3 — a live Multi-Level Plan holds its line (locked above).
  await assertNoLiveMlPlan(
    tx,
    companyId,
    eligible.map((l) => l.id),
  );

  // Refuse while anything is still being made for these lines.
  const running = await readRunningWork(
    tx,
    companyId,
    eligible.map((l) => l.id),
  );
  const blocked: string[] = [];
  for (const l of eligible) {
    const w = running.get(l.id);
    if (!w || (w.jcCodes.length === 0 && w.orderCodes.length === 0)) continue;
    const c = commitments.get(l.id);
    const parts: string[] = [];
    if (w.orderCodes.length > 0)
      parts.push(
        `Production Order${w.orderCodes.length > 1 ? 's' : ''} ${w.orderCodes.join(', ')}`,
      );
    if (w.jcCodes.length > 0)
      parts.push(`Job Card${w.jcCodes.length > 1 ? 's' : ''} ${w.jcCodes.join(', ')}`);
    blocked.push(`${c ? lineLabel(c) : `Line ${l.lineNo}`}: ${parts.join(' and ')}`);
  }
  if (blocked.length > 0) {
    throw new ConflictError(
      `Cannot close — work is still running. Close or short-close these first: ${blocked.join('; ')}.`,
    );
  }

  const now = new Date();
  for (const l of eligible) {
    const updated = await tx
      .update(salesOrderLines)
      .set({
        status: 'closed',
        shortClosedAt: now,
        shortClosedBy: user.id,
        shortCloseReason: reason,
        updatedAt: now,
        updatedBy: user.id,
      })
      .where(and(eq(salesOrderLines.id, l.id), isNull(salesOrderLines.shortClosedAt)))
      .returning({ id: salesOrderLines.id });
    if (updated.length === 0) {
      throw new ConflictError('Could not close the SO line. Refresh the page and try again.');
    }
    // ADR-180 — stock booked for the dropped qty goes back to free stock.
    await reconcileLineReservations(
      tx,
      {
        companyId,
        soLineId: l.id,
        newOrderQty: l.dispatchedQty,
        dispatchedQty: l.dispatchedQty,
        reason: `${hdr.code} ln ${l.lineNo} closed short — booking released`,
      },
      user,
    );
    const undelivered = Math.max(0, l.orderQty - l.dispatchedQty);
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.CloseShort,
        entity: 'SalesOrder',
        entityId: salesOrderId,
        refId: hdr.code,
        lineRef: `Line ${l.lineNo}`,
        // ADR-197 — the qty the close dropped (Order Qty − Dispatched).
        qty: undelivered,
        reason,
        detail: `${hdr.code} Ln ${l.lineNo} closed short (${undelivered} of ${l.orderQty} not delivered)`,
      },
      companyId,
      user,
    );
  }

  // ERPNext's Closed: once no live line of an OPEN order is left open, the
  // header closes too (the same roll-up the JC-completion cascade does).
  if (hdr.status === 'open') {
    const stillOpen = (await tx.execute(sql`
      SELECT COUNT(*)::int AS n FROM public.sales_order_lines
      WHERE sales_order_id = ${salesOrderId}::uuid AND deleted_at IS NULL
        AND status NOT IN ('closed', 'cancelled', 'dispatched')
    `)) as unknown as Array<{ n: number }>;
    if (Number(stillOpen[0]?.n ?? 0) === 0) {
      await tx
        .update(salesOrders)
        .set({ status: 'closed', updatedBy: user.id, updatedAt: now })
        .where(eq(salesOrders.id, salesOrderId));
      await emitActivityLog(
        tx,
        {
          action: ActivityAction.Close,
          entity: 'SalesOrder',
          entityId: salesOrderId,
          refId: hdr.code,
          changes: [{ field: 'status', label: 'SO Status', before: 'Open', after: 'Closed' }],
          reason,
          detail: `${hdr.code} — every line closed${mode === 'header' ? ' short' : ''}`,
        },
        companyId,
        user,
      );
    }
  }

  return eligible.length;
}

/** POST /sales-order-lines/:lineId/short-close — close ONE line short. */
export async function shortCloseSalesOrderLine(
  lineId: string,
  input: ShortCloseSalesOrderLineInput,
  user: AuthContext,
): Promise<SalesOrderDetail> {
  await requireClosePermission(user);
  const companyId = requireCompany(user);
  const reason = input.reason.trim();
  if (!reason) throw new ValidationError('Reason is required to close an SO line.');

  const salesOrderId = await withUserContext(user, async (tx) => {
    const rows = await tx
      .select({ salesOrderId: salesOrderLines.salesOrderId })
      .from(salesOrderLines)
      .where(
        and(
          eq(salesOrderLines.id, lineId),
          eq(salesOrderLines.companyId, companyId),
          isNull(salesOrderLines.deletedAt),
        ),
      )
      .limit(1);
    const soId = rows[0]?.salesOrderId;
    if (!soId) throw new NotFoundError('SO line not found. Refresh the page.');
    await shortCloseLinesTx(
      tx,
      { companyId, salesOrderId: soId, lineIds: [lineId], reason, mode: 'line' },
      user,
    );
    return soId;
  });
  return getSalesOrder(salesOrderId, user);
}

/** POST /sales-orders/:id/close — the header "Close": every live line that
 *  still has qty undelivered is closed short with the one reason. */
export async function closeSalesOrder(
  salesOrderId: string,
  input: CloseSalesOrderInput,
  user: AuthContext,
): Promise<SalesOrderDetail> {
  await requireClosePermission(user);
  const companyId = requireCompany(user);
  const reason = input.reason.trim();
  if (!reason) throw new ValidationError('Reason is required to close an SO.');

  await withUserContext(user, async (tx) => {
    const lines = await tx
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(
        and(
          eq(salesOrderLines.salesOrderId, salesOrderId),
          eq(salesOrderLines.companyId, companyId),
          isNull(salesOrderLines.deletedAt),
        ),
      );
    if (lines.length === 0) {
      throw new ConflictError('This SO has no lines — there is nothing to close.');
    }
    await shortCloseLinesTx(
      tx,
      {
        companyId,
        salesOrderId,
        lineIds: lines.map((l) => l.id),
        reason,
        mode: 'header',
      },
      user,
    );
  });
  return getSalesOrder(salesOrderId, user);
}
