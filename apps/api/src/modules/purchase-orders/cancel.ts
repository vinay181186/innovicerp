// ADR-235 Phase B — Purchase Order in the standard Cancel.
//
// A Draft PO, or an issued PO with NOTHING received (no live GRN, nothing on
// the lines' received qty) and nothing sent to the vendor (no live Delivery
// Challan / JW DC Outward), may be cancelled. The worker reuses the ONE PO
// cancel writer (po-cancel-writer.ts markPoCancelledTx — shared with Reject
// and Short Close's stop-wholly branch): status → 'cancelled' conditionally,
// who / when / why stamped, PRs and outsourced JC ops handed back.
//
// One refusal rule — purchaseOrderCancelBlockers — used by the preview, by the
// Cancel Request service (request + approve) and again by the worker, under
// the PO's lock and its lines' locks. No rights check here: the Cancel Request
// service checks the po_create ticks.

import { ActivityAction, type CancelBlocker } from '@innovic/shared';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { purchaseOrderLines, purchaseOrders } from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { ConflictError, NotFoundError } from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';
import { blockerRefusal } from '../cancel-requests/messages';
import {
  PO_CLOSED_REASON,
  poGrnBlockReason,
  poPartReceivedReason,
  poSentBlockReason,
  poStatusWord,
} from './cancel-text';
import { markPoCancelledTx } from './po-cancel-writer';

type PoRow = typeof purchaseOrders.$inferSelect;

/** Read the PO header; `forUpdate` locks it (request / approve), the preview
 *  reads without a lock. null = not found in this company. */
export async function lockPurchaseOrderForCancel(
  tx: DbTransaction,
  companyId: string,
  id: string,
  forUpdate: boolean,
): Promise<PoRow | null> {
  const q = tx
    .select()
    .from(purchaseOrders)
    .where(
      and(
        eq(purchaseOrders.id, id),
        eq(purchaseOrders.companyId, companyId),
        isNull(purchaseOrders.deletedAt),
      ),
    )
    .limit(1);
  const rows = forUpdate ? await q.for('update') : await q;
  return rows[0] ?? null;
}

interface DocHit {
  id: string;
  code: string;
  lineNos: string | null;
  qty: number;
}

/**
 * THE PO cancel refusal rule. Names every live document that moved goods
 * against the PO — by header OR by PO line, as poLiveGoodsDoc counts them — and
 * the received figure on the lines (it also covers older JW DC Inward receipts
 * that raised no GRN). A Closed PO is ended already.
 */
export async function purchaseOrderCancelBlockers(
  tx: DbTransaction,
  companyId: string,
  id: string,
): Promise<CancelBlocker[]> {
  const po = await lockPurchaseOrderForCancel(tx, companyId, id, false);
  if (!po || po.status === 'cancelled') return [];
  const out: CancelBlocker[] = [];

  const [grns, dcs, jwDcs, totals] = await Promise.all([
    tx.execute(sql`
      SELECT g.id, g.code,
        string_agg(DISTINCT pol.line_no::text, ', ') AS "lineNos",
        COALESCE(SUM(gl.received_qty) FILTER (WHERE pol.id IS NOT NULL), 0)::float8 AS qty
      FROM public.goods_receipt_notes g
      LEFT JOIN public.goods_receipt_note_lines gl
        ON gl.goods_receipt_note_id = g.id AND gl.deleted_at IS NULL
      LEFT JOIN public.purchase_order_lines pol
        ON pol.id = gl.purchase_order_line_id AND pol.purchase_order_id = ${id}::uuid
      WHERE g.company_id = ${companyId}::uuid AND g.deleted_at IS NULL
        AND (g.purchase_order_id = ${id}::uuid OR EXISTS (
          SELECT 1 FROM public.goods_receipt_note_lines x
          JOIN public.purchase_order_lines xp ON xp.id = x.purchase_order_line_id
          WHERE x.goods_receipt_note_id = g.id AND x.deleted_at IS NULL
            AND xp.purchase_order_id = ${id}::uuid))
      GROUP BY g.id, g.code
      ORDER BY g.code
    `),
    tx.execute(sql`
      SELECT dc.id, dc.code,
        string_agg(DISTINCT pol.line_no::text, ', ') AS "lineNos",
        COALESCE(SUM(dcl.qty) FILTER (WHERE pol.id IS NOT NULL), 0)::float8 AS qty
      FROM public.delivery_challans dc
      LEFT JOIN public.delivery_challan_lines dcl
        ON dcl.delivery_challan_id = dc.id AND dcl.deleted_at IS NULL
      LEFT JOIN public.purchase_order_lines pol
        ON pol.id = dcl.purchase_order_line_id AND pol.purchase_order_id = ${id}::uuid
      WHERE dc.company_id = ${companyId}::uuid AND dc.deleted_at IS NULL
        AND dc.status <> 'cancelled'
        AND (dc.purchase_order_id = ${id}::uuid OR EXISTS (
          SELECT 1 FROM public.delivery_challan_lines x
          JOIN public.purchase_order_lines xp ON xp.id = x.purchase_order_line_id
          WHERE x.delivery_challan_id = dc.id AND x.deleted_at IS NULL
            AND xp.purchase_order_id = ${id}::uuid))
      GROUP BY dc.id, dc.code
      ORDER BY dc.code
    `),
    tx.execute(sql`
      SELECT j.id, j.code,
        string_agg(DISTINCT pol.line_no::text, ', ') AS "lineNos",
        COALESCE(SUM(jl.sent_qty) FILTER (WHERE pol.id IS NOT NULL), 0)::float8 AS qty
      FROM public.jw_dc_outward j
      LEFT JOIN public.jw_dc_outward_lines jl
        ON jl.jw_dc_outward_id = j.id AND jl.deleted_at IS NULL
      LEFT JOIN public.purchase_order_lines pol
        ON pol.id = jl.purchase_order_line_id AND pol.purchase_order_id = ${id}::uuid
      WHERE j.company_id = ${companyId}::uuid AND j.deleted_at IS NULL
        AND (j.purchase_order_id = ${id}::uuid OR EXISTS (
          SELECT 1 FROM public.jw_dc_outward_lines x
          JOIN public.purchase_order_lines xp ON xp.id = x.purchase_order_line_id
          WHERE x.jw_dc_outward_id = j.id AND x.deleted_at IS NULL
            AND xp.purchase_order_id = ${id}::uuid))
      GROUP BY j.id, j.code
      ORDER BY j.code
    `),
    tx.execute(sql`
      SELECT COALESCE(SUM(qty), 0)::float8 AS ordered,
        COALESCE(SUM(received_qty), 0)::float8 AS received
      FROM public.purchase_order_lines
      WHERE purchase_order_id = ${id}::uuid AND deleted_at IS NULL
    `),
  ]);

  for (const g of grns as unknown as DocHit[]) {
    out.push({
      docLabel: 'GRN',
      docNo: g.code,
      href: `/goods-receipt-notes/${g.id}`,
      reason: poGrnBlockReason(g.lineNos, Number(g.qty)),
    });
  }
  for (const d of dcs as unknown as DocHit[]) {
    out.push({
      docLabel: 'DC',
      docNo: d.code,
      href: `/delivery-challans/${d.id}`,
      reason: poSentBlockReason('DC', d.lineNos, Number(d.qty)),
    });
  }
  for (const j of jwDcs as unknown as DocHit[]) {
    out.push({
      docLabel: 'JW DC',
      docNo: j.code,
      href: `/jw-dc/${j.id}`,
      reason: poSentBlockReason('JW DC', j.lineNos, Number(j.qty)),
    });
  }
  const t = (totals as unknown as Array<{ ordered: number; received: number }>)[0];
  const received = Number(t?.received ?? 0);
  if (received > 0) {
    out.push({
      docLabel: 'PO',
      docNo: po.code,
      href: null,
      reason: poPartReceivedReason(received, Number(t?.ordered ?? 0)),
    });
  }
  if (po.status === 'closed') {
    out.push({ docLabel: 'PO', docNo: po.code, href: null, reason: PO_CLOSED_REASON });
  }
  return out;
}

/**
 * The PO cancel worker, run only by an approved Cancel Request (ADR-235), in
 * the caller's transaction. Lock order: PO header, then its lines (id order) —
 * a GRN save locks the same PO lines, so a receipt either commits first and
 * is named below, or waits for this cancel. Then the rule, under the locks,
 * then the shared writer, then the CANCEL activity row with the reason.
 */
export async function cancelPurchaseOrderTx(
  tx: DbTransaction,
  companyId: string,
  id: string,
  reason: string,
  user: AuthContext,
): Promise<void> {
  const po = await lockPurchaseOrderForCancel(tx, companyId, id, true);
  if (!po) throw new NotFoundError('PO not found. It may have been moved to Trash.');
  if (po.status === 'cancelled') {
    throw new ConflictError(`PO ${po.code} is already Cancelled. Reload the page.`);
  }
  await tx
    .select({ id: purchaseOrderLines.id })
    .from(purchaseOrderLines)
    .where(
      and(
        eq(purchaseOrderLines.purchaseOrderId, id),
        eq(purchaseOrderLines.companyId, companyId),
        isNull(purchaseOrderLines.deletedAt),
      ),
    )
    .orderBy(asc(purchaseOrderLines.id))
    .for('update');

  const blockers = await purchaseOrderCancelBlockers(tx, companyId, id);
  if (blockers.length > 0) throw new ConflictError(blockerRefusal(po.code, blockers), { blockers });

  const trimmed = reason.trim();
  await markPoCancelledTx(tx, companyId, po, 'stopped', trimmed, user);
  await emitActivityLog(
    tx,
    {
      action: ActivityAction.Cancel,
      entity: 'PurchaseOrder',
      entityId: po.id,
      refId: po.code,
      reason: trimmed,
      changes: [
        {
          field: 'status',
          label: 'PO Status',
          before: poStatusWord(po.status),
          after: 'Cancelled',
        },
      ],
      detail: `${po.code} cancelled — nothing received or sent; PRs and JC ops released. Reason: ${trimmed}`,
    },
    companyId,
    user,
  );
}
