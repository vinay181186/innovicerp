// ADR-235 Phase C — Sales Order in the standard Cancel.
//
// The standard Cancel is the ONLY way to cancel a whole SO: the PATCH path
// refuses status → cancelled (updateSalesOrderTx). A Draft or Open SO with
// nothing downstream may be cancelled; the worker hands back every stock
// booking its lines hold (the delete path's writer, reconcileLineReservations
// with order qty 0), turns every live line Cancelled so line readers agree
// with the header, and stamps the header's cancel reason / when / who.
//
// One refusal rule — salesOrderCancelBlockers — used by the preview, by the
// Cancel Request service (request + approve) and again by the worker, under
// the SO's lock and its lines' locks. It covers what describeSoBlockingDocuments
// and assertNoLiveMlPlanOnSo refuse (plans, production orders, dispatches,
// invoices, Item Issues, reserved parts, Multi-Level Plans), and adds the
// documents raised straight off an SO line or the SO: hand-raised Job Cards,
// PRs, PO lines, Delivery Challans and Service POs — each named with a link.
// No rights check here: the Cancel Request service checks the so_create ticks.

import { ActivityAction, type CancelBlocker } from '@innovic/shared';
import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import { salesOrderLines, salesOrders } from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { ConflictError, NotFoundError } from '../../lib/errors';
import { readStockPositionLocked, reconcileLineReservations } from '../../lib/stock-reservation';
import { emitActivityLog } from '../activity-log/service';
import { blockerRefusal } from '../cancel-requests/messages';
import { SO_STATUS_WORDS } from './status-rules';

type SoRow = typeof salesOrders.$inferSelect;

/** Read the SO header; `forUpdate` locks it (request / approve), the preview
 *  reads without a lock. null = not found in this company. */
export async function lockSalesOrderForCancel(
  tx: DbTransaction,
  companyId: string,
  id: string,
  forUpdate: boolean,
): Promise<SoRow | null> {
  const q = tx
    .select()
    .from(salesOrders)
    .where(
      and(
        eq(salesOrders.id, id),
        eq(salesOrders.companyId, companyId),
        isNull(salesOrders.deletedAt),
      ),
    )
    .limit(1);
  const rows = forUpdate ? await q.for('update') : await q;
  return rows[0] ?? null;
}

interface Hit {
  id: string;
  code: string;
  lineNos: string | null;
  extra: string | null;
}

/** "Ln 1, 3" or '' when the document hangs off the header only. */
function onLines(lineNos: string | null): string {
  return lineNos ? `on Ln ${lineNos}` : 'on this SO';
}

const PRO_STATUS_WORDS: Record<string, string> = {
  open: 'Open',
  partially_closed: 'Partly Closed',
  closed: 'Closed',
  short_closed: 'Short Closed',
};

/**
 * THE SO cancel refusal rule. Every live downstream document — by SO line or
 * by SO header — named with a link, plus pieces already dispatched with no
 * live dispatch behind them, and a Closed / Dispatched header (SO_STATUS_MOVES:
 * only Draft and Open may become Cancelled). Reads without locks; the worker
 * holds the header + lines locks when it re-runs this.
 */
export async function salesOrderCancelBlockers(
  tx: DbTransaction,
  companyId: string,
  id: string,
): Promise<CancelBlocker[]> {
  const so = await lockSalesOrderForCancel(tx, companyId, id, false);
  if (!so || so.status === 'cancelled') return [];
  const out: CancelBlocker[] = [];

  if (so.status === 'closed' || so.status === 'dispatched') {
    out.push({
      docLabel: 'Sales Order',
      docNo: so.code,
      href: null,
      reason: `it is ${SO_STATUS_WORDS[so.status]} — only a Draft or Open SO can be cancelled`,
    });
  }

  // The SO's live lines, as a reusable fragment.
  const soLine = sql`SELECT id FROM public.sales_order_lines
    WHERE sales_order_id = ${id}::uuid AND company_id = ${companyId}::uuid AND deleted_at IS NULL`;

  const [
    plansHit,
    prosHit,
    jcsHit,
    mlHit,
    prsHit,
    posHit,
    dcsHit,
    dispatchesHit,
    invoicesHit,
    undocDispatched,
    issuesHit,
    held,
    spoHit,
  ] = await Promise.all([
    tx.execute(sql`
      SELECT p.id, p.code, string_agg(DISTINCT sol.line_no::text, ', ') AS "lineNos", NULL AS extra
      FROM public.plans p
      JOIN public.sales_order_lines sol ON sol.id = p.so_line_id
      WHERE p.so_line_id IN (${soLine}) AND p.company_id = ${companyId}::uuid
        AND p.deleted_at IS NULL AND p.plan_status <> 'cancelled'
      GROUP BY p.id, p.code ORDER BY p.code
    `),
    // A Production Order hangs off a live plan of the line (as
    // readSoLineCommitments counts them). A cancelled plan has none left.
    tx.execute(sql`
      SELECT po.id, po.code, string_agg(DISTINCT sol.line_no::text, ', ') AS "lineNos",
        MIN(po.status) AS extra
      FROM public.production_orders po
      JOIN public.plans p ON p.id = po.plan_id
      JOIN public.sales_order_lines sol ON sol.id = p.so_line_id
      WHERE p.so_line_id IN (${soLine}) AND po.company_id = ${companyId}::uuid
        AND po.deleted_at IS NULL AND p.deleted_at IS NULL AND p.plan_status <> 'cancelled'
      GROUP BY po.id, po.code ORDER BY po.code
    `),
    // Hand-raised Job Cards only — a Production Order's own JC is named via
    // its Production Order above.
    tx.execute(sql`
      SELECT jc.id, jc.code, string_agg(DISTINCT sol.line_no::text, ', ') AS "lineNos", NULL AS extra
      FROM public.job_cards jc
      JOIN public.sales_order_lines sol ON sol.id = jc.source_so_line_id
      WHERE jc.source_so_line_id IN (${soLine}) AND jc.company_id = ${companyId}::uuid
        AND jc.deleted_at IS NULL AND jc.production_order_id IS NULL
      GROUP BY jc.id, jc.code ORDER BY jc.code
    `),
    tx.execute(sql`
      SELECT mp.id, mp.code, string_agg(DISTINCT sol.line_no::text, ', ') AS "lineNos", NULL AS extra
      FROM public.ml_plans mp
      LEFT JOIN public.sales_order_lines sol ON sol.id = mp.so_line_id
      WHERE mp.sales_order_id = ${id}::uuid AND mp.company_id = ${companyId}::uuid
        AND mp.deleted_at IS NULL AND mp.status <> 'cancelled'
      GROUP BY mp.id, mp.code ORDER BY mp.code
    `),
    tx.execute(sql`
      SELECT pr.id, pr.code, string_agg(DISTINCT sol.line_no::text, ', ') AS "lineNos", NULL AS extra
      FROM public.purchase_requests pr
      JOIN public.sales_order_lines sol ON sol.id = pr.source_so_line_id
      WHERE pr.source_so_line_id IN (${soLine}) AND pr.company_id = ${companyId}::uuid
        AND pr.deleted_at IS NULL AND pr.status <> 'cancelled'
      GROUP BY pr.id, pr.code ORDER BY pr.code
    `),
    tx.execute(sql`
      SELECT po.id, po.code, string_agg(DISTINCT sol.line_no::text, ', ') AS "lineNos", NULL AS extra
      FROM public.purchase_order_lines pl
      JOIN public.purchase_orders po ON po.id = pl.purchase_order_id
      JOIN public.sales_order_lines sol ON sol.id = pl.source_so_line_id
      WHERE pl.source_so_line_id IN (${soLine}) AND pl.company_id = ${companyId}::uuid
        AND pl.deleted_at IS NULL AND po.deleted_at IS NULL AND po.status <> 'cancelled'
      GROUP BY po.id, po.code ORDER BY po.code
    `),
    tx.execute(sql`
      SELECT dc.id, dc.code, string_agg(DISTINCT sol.line_no::text, ', ') AS "lineNos", NULL AS extra
      FROM public.delivery_challans dc
      JOIN public.sales_order_lines sol ON sol.id = dc.sales_order_line_id
      WHERE dc.sales_order_line_id IN (${soLine}) AND dc.company_id = ${companyId}::uuid
        AND dc.deleted_at IS NULL AND dc.status <> 'cancelled'
      GROUP BY dc.id, dc.code ORDER BY dc.code
    `),
    tx.execute(sql`
      SELECT cd.id, cd.code, string_agg(DISTINCT sol.line_no::text, ', ') AS "lineNos", NULL AS extra
      FROM public.customer_dispatches cd
      LEFT JOIN public.customer_dispatch_lines cdl
        ON cdl.customer_dispatch_id = cd.id AND cdl.deleted_at IS NULL
      LEFT JOIN public.sales_order_lines sol
        ON sol.id = cdl.sales_order_line_id AND sol.sales_order_id = ${id}::uuid
      WHERE cd.company_id = ${companyId}::uuid AND cd.deleted_at IS NULL
        AND cd.status <> 'cancelled'
        AND (cd.sales_order_id = ${id}::uuid OR EXISTS (
          SELECT 1 FROM public.customer_dispatch_lines x
          WHERE x.customer_dispatch_id = cd.id AND x.deleted_at IS NULL
            AND x.sales_order_line_id IN (${soLine})))
      GROUP BY cd.id, cd.code ORDER BY cd.code
    `),
    tx.execute(sql`
      SELECT inv.id, inv.code, string_agg(DISTINCT sol.line_no::text, ', ') AS "lineNos", NULL AS extra
      FROM public.invoices inv
      LEFT JOIN public.invoice_lines il ON il.invoice_id = inv.id AND il.deleted_at IS NULL
      LEFT JOIN public.sales_order_lines sol
        ON sol.id = il.sales_order_line_id AND sol.sales_order_id = ${id}::uuid
      WHERE inv.company_id = ${companyId}::uuid AND inv.deleted_at IS NULL
        AND inv.status <> 'cancelled'
        AND (inv.sales_order_id = ${id}::uuid OR EXISTS (
          SELECT 1 FROM public.invoice_lines x
          WHERE x.invoice_id = inv.id AND x.deleted_at IS NULL
            AND x.sales_order_line_id IN (${soLine})))
      GROUP BY inv.id, inv.code ORDER BY inv.code
    `),
    // Pieces on the line's dispatched figure with no live dispatch line behind
    // them (old / imported data) — still shipped, so still a refusal.
    tx.execute(sql`
      SELECT sol.line_no AS "lineNo", sol.dispatched_qty::int AS qty
      FROM public.sales_order_lines sol
      WHERE sol.id IN (${soLine}) AND sol.dispatched_qty > 0
        AND NOT EXISTS (
          SELECT 1 FROM public.customer_dispatch_lines cdl
          JOIN public.customer_dispatches cd ON cd.id = cdl.customer_dispatch_id
          WHERE cdl.sales_order_line_id = sol.id AND cdl.deleted_at IS NULL
            AND cd.deleted_at IS NULL AND cd.status <> 'cancelled')
      ORDER BY sol.line_no
    `),
    tx.execute(sql`
      SELECT code FROM public.store_issues
      WHERE company_id = ${companyId}::uuid AND sales_order_id = ${id}::uuid
        AND deleted_at IS NULL AND reversed_at IS NULL
      ORDER BY code
    `),
    tx.execute(sql`
      SELECT COUNT(DISTINCT item_id)::int AS n FROM public.assembly_part_reservations
      WHERE company_id = ${companyId}::uuid AND sales_order_id = ${id}::uuid
        AND deleted_at IS NULL AND status IN ('active', 'partially_consumed')
    `),
    tx.execute(sql`
      SELECT id, spo_no AS code, NULL AS "lineNos", NULL AS extra
      FROM public.service_pos
      WHERE company_id = ${companyId}::uuid AND so_ref_id = ${id}::uuid
        AND deleted_at IS NULL AND status <> 'cancelled'
      ORDER BY spo_no
    `),
  ]);

  const push = (
    rows: unknown,
    docLabel: string,
    href: ((h: Hit) => string) | null,
    reason: (h: Hit) => string,
  ): void => {
    for (const h of rows as Hit[]) {
      out.push({ docLabel, docNo: h.code, href: href ? href(h) : null, reason: reason(h) });
    }
  };
  push(
    plansHit,
    'Plan',
    (h) => `/plans/${h.id}`,
    (h) => `planned ${onLines(h.lineNos)}`,
  );
  push(
    prosHit,
    'Production Order',
    (h) => `/production-orders/${h.id}`,
    (h) => `${PRO_STATUS_WORDS[h.extra ?? ''] ?? h.extra ?? 'live'} ${onLines(h.lineNos)}`,
  );
  push(
    jcsHit,
    'Job Card',
    (h) => `/job-cards/${h.id}`,
    (h) => `raised ${onLines(h.lineNos)}`,
  );
  push(
    mlHit,
    'Multi-Level Plan',
    (h) => `/ml-plans/${h.id}`,
    (h) => `planned ${onLines(h.lineNos)}`,
  );
  push(
    prsHit,
    'PR',
    (h) => `/purchase-requests/${h.id}`,
    (h) => `raised ${onLines(h.lineNos)}`,
  );
  push(
    posHit,
    'PO',
    (h) => `/purchase-orders/${h.id}`,
    (h) => `orders ${onLines(h.lineNos)}`,
  );
  push(
    dcsHit,
    'DC',
    (h) => `/delivery-challans/${h.id}`,
    (h) => `sent ${onLines(h.lineNos)}`,
  );
  push(
    dispatchesHit,
    'Customer Dispatch',
    (h) => `/customer-dispatches/${h.id}`,
    (h) => `dispatched ${onLines(h.lineNos)}`,
  );
  push(
    invoicesHit,
    'Invoice',
    (h) => `/invoices/${h.id}`,
    (h) => `invoiced ${onLines(h.lineNos)}`,
  );
  for (const d of undocDispatched as unknown as Array<{ lineNo: number; qty: number }>) {
    out.push({
      docLabel: 'Sales Order',
      docNo: so.code,
      href: null,
      reason: `Ln ${d.lineNo}: ${Number(d.qty)} pcs already dispatched`,
    });
  }
  for (const i of issuesHit as unknown as Array<{ code: string }>) {
    out.push({
      docLabel: 'Item Issue',
      docNo: i.code,
      href: `/assemblies/${id}`,
      reason: 'issued parts for this SO — reverse it first',
    });
  }
  const heldItems = Number((held as unknown as Array<{ n: number }>)[0]?.n ?? 0);
  if (heldItems > 0) {
    out.push({
      docLabel: 'Reserved parts',
      docNo: so.code,
      href: `/assemblies/${id}`,
      reason: `${heldItems} item${heldItems > 1 ? 's' : ''} reserved for assembly — release them first`,
    });
  }
  push(spoHit, 'Service PO', null, () => 'raised against this SO');
  return out;
}

/** The SO's live lines with the bookings they still hold — for the preview. */
export async function salesOrderHeldBookings(
  tx: DbTransaction,
  companyId: string,
  id: string,
): Promise<Array<{ lineNo: number; itemCode: string | null; held: number }>> {
  const rows = (await tx.execute(sql`
    SELECT sol.line_no AS "lineNo", COALESCE(i.code, sol.item_code_text) AS "itemCode",
      SUM(r.qty - r.consumed_qty - r.released_qty)::int AS held
    FROM public.sales_order_lines sol
    JOIN public.so_stock_reservations r
      ON r.so_line_id = sol.id AND r.deleted_at IS NULL
      AND r.status IN ('active', 'partially_consumed')
    LEFT JOIN public.items i ON i.id = sol.item_id
    WHERE sol.sales_order_id = ${id}::uuid AND sol.company_id = ${companyId}::uuid
      AND sol.deleted_at IS NULL
    GROUP BY sol.line_no, i.code, sol.item_code_text
    HAVING SUM(r.qty - r.consumed_qty - r.released_qty) > 0
    ORDER BY sol.line_no
  `)) as unknown as Array<{ lineNo: number; itemCode: string | null; held: number }>;
  return rows.map((r) => ({
    lineNo: Number(r.lineNo),
    itemCode: r.itemCode,
    held: Number(r.held),
  }));
}

/**
 * The SO cancel worker, run only by an approved Cancel Request (ADR-235), in
 * the caller's transaction. Lock order: SO header, then its lines (id order) —
 * the same order the SO edit and short close take, so a plan / dispatch raised
 * on a line either commits first and is named below, or waits for this cancel.
 * Then the rule under the locks, then the writes, then the CANCEL activity row.
 */
export async function cancelSalesOrderTx(
  tx: DbTransaction,
  companyId: string,
  id: string,
  reason: string,
  user: AuthContext,
): Promise<void> {
  const so = await lockSalesOrderForCancel(tx, companyId, id, true);
  if (!so) throw new NotFoundError('SO not found. It may have been moved to Trash.');
  if (so.status === 'cancelled') {
    throw new ConflictError(`${so.code} is already Cancelled. Reload the page.`);
  }
  const lines = await tx
    .select({ id: salesOrderLines.id, itemId: salesOrderLines.itemId })
    .from(salesOrderLines)
    .where(
      and(
        eq(salesOrderLines.salesOrderId, id),
        eq(salesOrderLines.companyId, companyId),
        isNull(salesOrderLines.deletedAt),
      ),
    )
    .orderBy(asc(salesOrderLines.id))
    .for('update');

  const blockers = await salesOrderCancelBlockers(tx, companyId, id);
  if (blockers.length > 0) throw new ConflictError(blockerRefusal(so.code, blockers), { blockers });

  const trimmed = reason.trim();
  const now = new Date();

  // Hand back every booking the lines hold — the delete path's writer
  // (reconcileLineReservations with order qty 0). Each item is locked first,
  // as a booking does, so a release never interleaves with an Allocate.
  const itemIds = [...new Set(lines.flatMap((l) => (l.itemId ? [l.itemId] : [])))].sort();
  for (const itemId of itemIds) await readStockPositionLocked(tx, companyId, itemId);
  let released = 0;
  for (const line of lines) {
    released += await reconcileLineReservations(
      tx,
      {
        companyId,
        soLineId: line.id,
        newOrderQty: 0,
        dispatchedQty: 0,
        reason: `SO ${so.code} cancelled — booking released`,
      },
      user,
    );
  }

  // Every live line follows the header, so line readers agree with it.
  await tx
    .update(salesOrderLines)
    .set({ status: 'cancelled', updatedBy: user.id, updatedAt: now })
    .where(
      and(
        eq(salesOrderLines.salesOrderId, id),
        isNull(salesOrderLines.deletedAt),
        ne(salesOrderLines.status, 'cancelled'),
      ),
    );

  // §20.2 — conditional on the status read under the lock.
  const moved = await tx
    .update(salesOrders)
    .set({
      status: 'cancelled',
      cancelReason: trimmed,
      cancelledAt: now,
      cancelledBy: user.id,
      updatedBy: user.id,
      updatedAt: now,
    })
    .where(and(eq(salesOrders.id, id), eq(salesOrders.status, so.status)))
    .returning({ id: salesOrders.id });
  if (moved.length === 0) {
    throw new ConflictError(`${so.code} was changed by someone else just now — reload the page.`);
  }

  await emitActivityLog(
    tx,
    {
      action: ActivityAction.Cancel,
      entity: 'SalesOrder',
      entityId: so.id,
      refId: so.code,
      reason: trimmed,
      changes: [
        {
          field: 'status',
          label: 'SO Status',
          before: SO_STATUS_WORDS[so.status],
          after: 'Cancelled',
        },
      ],
      detail:
        `${so.code} cancelled — all lines Cancelled` +
        (released > 0 ? `, ${released} booked pcs released to free stock` : '') +
        `. Reason: ${trimmed}`,
    },
    companyId,
    user,
  );
}
