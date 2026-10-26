// ADR-235 Phase C (part 1) — GRN in the standard Cancel.
//
// A GRN may be cancelled ONLY while its Incoming QC is untouched (no line has
// any qty accepted / rejected and every line is still QC 'pending'). Stock
// posts only at QC (creditGrnQcStock), so such a GRN moved no stock: the cancel
// takes its received qty off the PO lines (recalcPoLineReceivedQty — the ONE
// writer of purchase_order_lines.received_qty, §20.1) and re-reads the PO
// header status (recalcPoHeaderStatus), exactly as the soft delete does.
// QC reversal is a later step — a QC-touched GRN is refused.
//
// Phase C part 2: the receipt that MADE a GRN (DC receipt / JW DC receipt) now
// has its own cancel, and that cancel takes its GRN with it in the same
// transaction by calling grnCancelBlockers / cancelGrnTx with
// `{ viaReceipt: true }`. That option skips ONLY grnSourceReceiptBlockers (the
// "made by … receipt — cancel that receipt instead" rule) — every other rule
// (Incoming QC touched, live NC on a line) still refuses.
//
// Only a GRN booked by hand / against a purchase PO cancels in this phase. A
// GRN MADE by another document's receipt — a DC receipt (delivery_challan_id),
// a JW DC receipt (jw_dc_inward.goods_receipt_note_id) or an NC replacement
// (nc_id) — belongs to that receipt and is refused on its own (cancel the
// receipt instead; an NC replacement receipt has no cancel yet). The soft delete refuses the same GRNs through the same
// rule (grnSourceReceiptBlockers), closing the gap where a delete left those
// documents pointing at a vanished GRN.
//
// A GRN is cancelled the way Party GRN is (Phase B): header + live lines
// stamped with ONE deleted_at (so every live reader keeps skipping them) plus
// cancel_reason / cancelled_at (same instant) / cancelled_by on the header
// (0220) — the list (includeCancelled) and the detail read those to show the
// GRN as Cancelled, with the lines whose deleted_at equals the header's.
//
// One refusal rule — grnCancelBlockers — used by the preview, by the Cancel
// Request service (request + approve) and again by the worker under its locks.
// No rights check here: the Cancel Request service checks the grn_create ticks.

import { ActivityAction, type CancelBlocker, type CancelEffect } from '@innovic/shared';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { goodsReceiptNoteLines, goodsReceiptNotes, purchaseOrderLines } from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { softDeleteStamp } from '../../lib/audit-trail';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';
import { blockerRefusal } from '../cancel-requests/messages';
import { recalcPoHeaderStatus, recalcPoLineReceivedQty } from './cascades';

export interface GrnCancelHead {
  id: string;
  code: string;
  vendorCodeText: string | null;
  deliveryChallanId: string | null;
  ncId: string | null;
  deletedAt: unknown;
  cancelledAt: unknown;
}

/** Read the GRN header — cancelled AND trashed ones included (both stamp
 *  deleted_at; the caller tells them apart). `forUpdate` locks it (request /
 *  approve / the worker); the preview reads without a lock. null = not in this
 *  company. */
export async function lockGrnForCancel(
  tx: DbTransaction,
  companyId: string,
  id: string,
  forUpdate: boolean,
): Promise<GrnCancelHead | null> {
  const rows = (await tx.execute(sql`
    SELECT id, code, vendor_code_text AS "vendorCodeText",
           delivery_challan_id AS "deliveryChallanId", nc_id AS "ncId",
           deleted_at AS "deletedAt", cancelled_at AS "cancelledAt"
      FROM public.goods_receipt_notes
     WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid
     ${forUpdate ? sql`FOR UPDATE` : sql``}
  `)) as unknown as GrnCancelHead[];
  return rows[0] ?? null;
}

/** The live lines a cancel reads (blockers, effects and the worker alike). */
async function grnCancelLines(tx: DbTransaction, companyId: string, id: string) {
  return tx
    .select({
      id: goodsReceiptNoteLines.id,
      lineNo: goodsReceiptNoteLines.lineNo,
      purchaseOrderLineId: goodsReceiptNoteLines.purchaseOrderLineId,
      receivedQty: goodsReceiptNoteLines.receivedQty,
      qcStatus: goodsReceiptNoteLines.qcStatus,
      qcAcceptedQty: goodsReceiptNoteLines.qcAcceptedQty,
      qcRejectedQty: goodsReceiptNoteLines.qcRejectedQty,
    })
    .from(goodsReceiptNoteLines)
    .where(
      and(
        eq(goodsReceiptNoteLines.goodsReceiptNoteId, id),
        eq(goodsReceiptNoteLines.companyId, companyId),
        isNull(goodsReceiptNoteLines.deletedAt),
      ),
    )
    .orderBy(asc(goodsReceiptNoteLines.lineNo));
}

type GrnCancelLine = Awaited<ReturnType<typeof grnCancelLines>>[number];

/** A line Incoming QC has touched: any qty inspected, or its status moved. */
function qcTouched(l: GrnCancelLine): boolean {
  return l.qcStatus !== 'pending' || Number(l.qcAcceptedQty) > 0 || Number(l.qcRejectedQty) > 0;
}

/**
 * The GRNs another receipt MADE — refused by both the cancel and the soft
 * delete (one rule). Each names the receipt the GRN belongs to:
 *  · an NC replacement receipt (nc_id) — named as the NC (its return challan's
 *    receipt raised the GRN, so the DC is not named a second time);
 *  · a DC receipt (delivery_challan_id) — named as the DC;
 *  · a JW DC receipt (a live jw_dc_inward row pointing at the GRN).
 */
export async function grnSourceReceiptBlockers(
  tx: DbTransaction,
  companyId: string,
  head: Pick<GrnCancelHead, 'id' | 'deliveryChallanId' | 'ncId'>,
): Promise<CancelBlocker[]> {
  const out: CancelBlocker[] = [];
  if (head.ncId) {
    const nc = (
      (await tx.execute(sql`
        SELECT code FROM public.nc_register WHERE id = ${head.ncId}::uuid
      `)) as unknown as Array<{ code: string }>
    )[0];
    const code = nc?.code ?? 'NC';
    out.push({
      docLabel: 'NC',
      docNo: code,
      href: `/nc-register/${head.ncId}`,
      reason: `made by NC replacement ${code} — cancel that receipt instead (not available yet)`,
    });
  } else if (head.deliveryChallanId) {
    const dc = (
      (await tx.execute(sql`
        SELECT code FROM public.delivery_challans WHERE id = ${head.deliveryChallanId}::uuid
      `)) as unknown as Array<{ code: string }>
    )[0];
    const code = dc?.code ?? 'DC';
    out.push({
      docLabel: 'DC',
      docNo: code,
      href: `/delivery-challans/${head.deliveryChallanId}`,
      reason: `made by a DC receipt on ${code} — cancel that receipt instead`,
    });
  }
  const inwards = (await tx.execute(sql`
    SELECT code, jw_dc_outward_id AS "outwardId"
      FROM public.jw_dc_inward
     WHERE goods_receipt_note_id = ${head.id}::uuid
       AND company_id = ${companyId}::uuid
       AND deleted_at IS NULL
     ORDER BY code
  `)) as unknown as Array<{ code: string; outwardId: string }>;
  for (const w of inwards) {
    out.push({
      docLabel: 'JW DC Receipt',
      docNo: w.code,
      href: `/jw-dc/${w.outwardId}`,
      reason: `made by JW DC receipt ${w.code} — cancel that receipt instead`,
    });
  }
  return out;
}

/**
 * THE GRN cancel refusal rule (one place — the worker under its locks, the
 * Cancel Request service and the preview all call it):
 *  · a line with Incoming QC recorded (QC reversal is not available yet);
 *  · a GRN made by a DC / JW DC / NC replacement receipt (grnSourceReceiptBlockers);
 *  · any live NC raised on its lines.
 * A cancelled / trashed / missing GRN has nothing to refuse (the lock step says so).
 */
export interface GrnCancelOptions {
  /** The receipt that made this GRN is being cancelled and takes the GRN with
   *  it — skip ONLY the "made by a receipt" rule (grnSourceReceiptBlockers). */
  viaReceipt?: boolean;
}

export async function grnCancelBlockers(
  tx: DbTransaction,
  companyId: string,
  id: string,
  opts: GrnCancelOptions = {},
): Promise<CancelBlocker[]> {
  const head = await lockGrnForCancel(tx, companyId, id, false);
  if (!head || head.deletedAt != null) return [];
  const out: CancelBlocker[] = [];
  const href = `/goods-receipt-notes/${id}`;

  const lines = await grnCancelLines(tx, companyId, id);
  for (const l of lines.filter(qcTouched)) {
    out.push({
      docLabel: 'Incoming QC',
      docNo: `${head.code} Ln ${l.lineNo}`,
      href,
      reason: `Ln ${l.lineNo} has Incoming QC recorded — QC reversal is not available yet`,
    });
  }

  if (!opts.viaReceipt) out.push(...(await grnSourceReceiptBlockers(tx, companyId, head)));

  if (lines.length > 0) {
    const ncs = (await tx.execute(sql`
      SELECT nc.id, nc.code, gl.line_no AS "lineNo"
        FROM public.nc_register nc
        JOIN public.goods_receipt_note_lines gl ON gl.id = nc.grn_line_id
       WHERE gl.goods_receipt_note_id = ${id}::uuid
         AND gl.deleted_at IS NULL
         AND nc.company_id = ${companyId}::uuid
         AND nc.deleted_at IS NULL
       ORDER BY nc.code
    `)) as unknown as Array<{ id: string; code: string; lineNo: number }>;
    for (const nc of ncs) {
      out.push({
        docLabel: 'NC',
        docNo: nc.code,
        href: `/nc-register/${nc.id}`,
        reason: `raised on Ln ${nc.lineNo} — QC reversal is not available yet`,
      });
    }
  }
  return out;
}

/** What the cancel will do — the Cancel preview's lines. */
export async function grnCancelEffects(
  tx: DbTransaction,
  companyId: string,
  id: string,
): Promise<CancelEffect[]> {
  const head = await lockGrnForCancel(tx, companyId, id, false);
  if (!head || head.deletedAt != null) return [];
  const lines = await grnCancelLines(tx, companyId, id);
  const polIds = Array.from(
    new Set(lines.flatMap((l) => (l.purchaseOrderLineId ? [l.purchaseOrderLineId] : []))),
  );
  const pols =
    polIds.length > 0
      ? ((await tx.execute(sql`
          SELECT pol.id, pol.line_no AS "lineNo", po.code AS "poCode"
            FROM public.purchase_order_lines pol
            JOIN public.purchase_orders po ON po.id = pol.purchase_order_id
           WHERE pol.id IN (${sql.join(
             polIds.map((x) => sql`${x}::uuid`),
             sql`, `,
           )})
             AND pol.company_id = ${companyId}::uuid
        `)) as unknown as Array<{ id: string; lineNo: number; poCode: string }>)
      : [];
  const polById = new Map(pols.map((p) => [p.id, p]));

  // Per PO line (two GRN lines on one PO line are summed).
  const qtyByPol = new Map<string, number>();
  for (const l of lines) {
    if (!l.purchaseOrderLineId) continue;
    qtyByPol.set(
      l.purchaseOrderLineId,
      (qtyByPol.get(l.purchaseOrderLineId) ?? 0) + Number(l.receivedQty),
    );
  }

  const out: CancelEffect[] = [];
  for (const [polId, qty] of qtyByPol) {
    const p = polById.get(polId);
    if (!p || qty <= 0) continue;
    out.push({
      kind: 'reopen',
      text: `${p.poCode} Ln ${p.lineNo}: ${qty} back to Pending receipt`,
      qty,
    });
  }
  out.push({ kind: 'note', text: 'No stock moves — nothing was inspected yet', qty: null });
  return out;
}

/**
 * The ONE GRN cancel writer, run only by an approved Cancel Request (ADR-235),
 * in the caller's transaction. No rights check — the Cancel Request checks the
 * ticks. Lock order: GRN header, its lines (id order), then the PO lines they
 * received against (id order) — the order a GRN edit uses (header → lines →
 * PO lines) and the PO-line lock a GRN create takes, so a concurrent QC / edit
 * / receipt either commits first and is seen by the rule below, or waits.
 */
export async function cancelGrnTx(
  tx: DbTransaction,
  companyId: string,
  id: string,
  reason: string,
  user: AuthContext,
  opts: GrnCancelOptions = {},
): Promise<{ code: string; qty: number }> {
  const trimmed = (reason ?? '').trim();
  if (!trimmed) throw new ValidationError('Reason is required to cancel a GRN.');

  // Lock the header, THEN re-check it is live — two cancels (or a cancel and a
  // delete) on the same GRN queue here and the second one sees deleted_at.
  const head = await lockGrnForCancel(tx, companyId, id, true);
  if (!head) throw new NotFoundError('GRN not found. Refresh the page.');
  if (head.cancelledAt != null) {
    throw new ConflictError(`${head.code} is already cancelled. Refresh the page.`);
  }
  if (head.deletedAt != null) {
    throw new ConflictError(`${head.code} has been moved to Trash. Refresh the page.`);
  }

  // The GRN lines — an Incoming QC submit locks the same line, so an inspection
  // either commits first (and the rule below refuses) or waits and then finds
  // the line cancelled.
  const lockedLines = await tx
    .select({
      id: goodsReceiptNoteLines.id,
      purchaseOrderLineId: goodsReceiptNoteLines.purchaseOrderLineId,
      receivedQty: goodsReceiptNoteLines.receivedQty,
    })
    .from(goodsReceiptNoteLines)
    .where(
      and(
        eq(goodsReceiptNoteLines.goodsReceiptNoteId, id),
        eq(goodsReceiptNoteLines.companyId, companyId),
        isNull(goodsReceiptNoteLines.deletedAt),
      ),
    )
    .orderBy(asc(goodsReceiptNoteLines.id))
    .for('update');

  const touchedPoLineIds = Array.from(
    new Set(lockedLines.flatMap((l) => (l.purchaseOrderLineId ? [l.purchaseOrderLineId] : []))),
  ).sort();
  if (touchedPoLineIds.length > 0) {
    await tx
      .select({ id: purchaseOrderLines.id })
      .from(purchaseOrderLines)
      .where(inArray(purchaseOrderLines.id, touchedPoLineIds))
      .orderBy(asc(purchaseOrderLines.id))
      .for('update');
  }

  // The refusal rule, under the locks — before anything moves.
  const blockers = await grnCancelBlockers(tx, companyId, id, opts);
  if (blockers.length > 0) {
    throw new ConflictError(blockerRefusal(head.code, blockers), { blockers });
  }

  // ONE stamp for header and lines: a cancelled GRN's own lines are exactly
  // those whose deleted_at equals the header's (lines removed earlier keep
  // their own, older stamp). cancelled_at is the same instant (ADR-235, 0220).
  const stamp = softDeleteStamp(user);
  await tx
    .update(goodsReceiptNoteLines)
    .set({ ...stamp, updatedAt: stamp.deletedAt, updatedBy: user.id })
    .where(
      and(
        eq(goodsReceiptNoteLines.goodsReceiptNoteId, id),
        eq(goodsReceiptNoteLines.companyId, companyId),
        isNull(goodsReceiptNoteLines.deletedAt),
      ),
    );
  const cancelled = await tx
    .update(goodsReceiptNotes)
    .set({
      ...stamp,
      cancelReason: trimmed,
      cancelledAt: stamp.deletedAt,
      cancelledBy: user.id,
      updatedAt: stamp.deletedAt,
      updatedBy: user.id,
    })
    .where(
      and(
        eq(goodsReceiptNotes.id, id),
        eq(goodsReceiptNotes.companyId, companyId),
        isNull(goodsReceiptNotes.deletedAt),
      ),
    )
    .returning({ id: goodsReceiptNotes.id });
  if (cancelled.length === 0) {
    throw new ConflictError(
      `${head.code} has just been cancelled by someone else. Refresh the page.`,
    );
  }

  // Received qty off the PO lines, then the PO headers' status — as the soft
  // delete does (the one writer of each).
  const touchedPoHeaderIds = new Set<string>();
  for (const polId of touchedPoLineIds) {
    await recalcPoLineReceivedQty(tx, polId, user.id);
    const polRows = await tx
      .select({ purchaseOrderId: purchaseOrderLines.purchaseOrderId })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.id, polId))
      .limit(1);
    if (polRows[0]) touchedPoHeaderIds.add(polRows[0].purchaseOrderId);
  }
  for (const poId of touchedPoHeaderIds) {
    await recalcPoHeaderStatus(tx, poId, user.id);
  }

  const qty = lockedLines.reduce((s, l) => s + Number(l.receivedQty), 0);
  await emitActivityLog(
    tx,
    {
      action: ActivityAction.Cancel,
      entity: 'GoodsReceiptNote',
      entityId: head.id,
      refId: head.code,
      qty,
      reason: trimmed,
      detail:
        `${head.code} cancelled${opts.viaReceipt ? ' with the receipt that made it' : ''} — ` +
        `${qty} taken off Pending receipt on its PO lines; ` +
        `no stock moved (nothing was inspected). Reason: ${trimmed}`,
    },
    companyId,
    user,
  );

  return { code: head.code, qty };
}
