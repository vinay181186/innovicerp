// JW DC (outward) — Cancel (ADR-235 Phase C). Only via an approved Cancel
// Request. Every line's 'jw_out' stock-out is put back by an OPPOSITE 'in'
// entry (same source type, ref "(cancel)"), never by editing the 'out'. Header
// and lines are then stamped with ONE soft-delete stamp, so the SENT figure
// (lib/po-line-sent.ts JW_SENT_WHERE) and every other live reader drop the
// challan unchanged, and cancel_reason / cancelled_at (the same instant) /
// cancelled_by (0220) let the list show it as Cancelled.
//
// Only while nothing has come back on it: a live JW DC receipt (JWIN-x)
// blocks. There is no receipt cancel yet, so that simply blocks.

import { ActivityAction, type CancelBlocker, type CancelEffect } from '@innovic/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { jwDcOutward, jwDcOutwardLines } from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { softDeleteStamp } from '../../lib/audit-trail';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { postStockMove, roundQty } from '../../lib/stock-ledger';
import { emitActivityLog } from '../activity-log/service';
import { blockerRefusal } from '../cancel-requests/messages';

export interface JwDcOutwardCancelHead {
  id: string;
  code: string;
  vendorNameText: string | null;
  deletedAt: unknown;
  cancelledAt: unknown;
}

/** Read the outward header — cancelled ones included (a cancel stamps
 *  deleted_at). `forUpdate` locks it (request / approve / the worker); the
 *  preview reads without a lock. null = not in this company, or deleted
 *  without a cancel. */
export async function lockJwDcOutwardForCancel(
  tx: DbTransaction,
  companyId: string,
  id: string,
  forUpdate: boolean,
): Promise<JwDcOutwardCancelHead | null> {
  const rows = (await tx.execute(sql`
    SELECT id, code, vendor_name_text AS "vendorNameText",
           deleted_at AS "deletedAt", cancelled_at AS "cancelledAt"
      FROM public.jw_dc_outward
     WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid
       AND (deleted_at IS NULL OR cancelled_at IS NOT NULL)
     ${forUpdate ? sql`FOR UPDATE` : sql``}
  `)) as unknown as JwDcOutwardCancelHead[];
  return rows[0] ?? null;
}

interface CancelLine {
  id: string;
  lineNo: number;
  purchaseOrderLineId: string | null;
  poLineNo: number | null;
  poCode: string | null;
  itemId: string | null;
  itemCodeText: string;
  sentQty: number;
}

/** The live lines a cancel reads (effects and the worker alike). */
async function readCancelLines(
  tx: DbTransaction,
  companyId: string,
  id: string,
): Promise<CancelLine[]> {
  const rows = (await tx.execute(sql`
    SELECT jdol.id, jdol.line_no AS "lineNo",
           jdol.purchase_order_line_id AS "purchaseOrderLineId",
           pol.line_no AS "poLineNo",
           COALESCE(po.code, jdo.jwpo_code_text) AS "poCode",
           jdol.item_id AS "itemId", jdol.item_code_text AS "itemCodeText",
           jdol.sent_qty::float8 AS "sentQty"
      FROM public.jw_dc_outward_lines jdol
      JOIN public.jw_dc_outward jdo ON jdo.id = jdol.jw_dc_outward_id
      LEFT JOIN public.purchase_order_lines pol ON pol.id = jdol.purchase_order_line_id
      LEFT JOIN public.purchase_orders po ON po.id = pol.purchase_order_id
     WHERE jdol.jw_dc_outward_id = ${id}::uuid AND jdol.company_id = ${companyId}::uuid
       AND jdol.deleted_at IS NULL
     ORDER BY jdol.line_no
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r['id']),
    lineNo: Number(r['lineNo']),
    purchaseOrderLineId: (r['purchaseOrderLineId'] as string | null) ?? null,
    poLineNo: r['poLineNo'] != null ? Number(r['poLineNo']) : null,
    poCode: (r['poCode'] as string | null) ?? null,
    itemId: (r['itemId'] as string | null) ?? null,
    itemCodeText: String(r['itemCodeText'] ?? ''),
    sentQty: Number(r['sentQty'] ?? 0),
  }));
}

/**
 * THE JW DC (outward) cancel refusal rule (one place — the worker, under its
 * locks, and the Cancel preview both call it): every live JW DC receipt
 * recorded against it is named.
 */
export async function jwDcOutwardCancelBlockers(
  tx: DbTransaction,
  companyId: string,
  id: string,
): Promise<CancelBlocker[]> {
  const head = await lockJwDcOutwardForCancel(tx, companyId, id, false);
  if (!head || head.deletedAt != null) return [];
  const receipts = (await tx.execute(sql`
    SELECT jdi.code
      FROM public.jw_dc_inward jdi
     WHERE jdi.jw_dc_outward_id = ${id}::uuid AND jdi.company_id = ${companyId}::uuid
       AND jdi.deleted_at IS NULL
     ORDER BY jdi.code
  `)) as unknown as Array<{ code: string }>;
  return receipts.map((r) => ({
    docLabel: 'JW DC receipt',
    docNo: r.code,
    href: null,
    reason: 'a receipt is recorded against this DC — cancel it first',
  }));
}

/** What the cancel will do — shown before the user commits. */
export async function jwDcOutwardCancelEffects(
  tx: DbTransaction,
  companyId: string,
  id: string,
): Promise<CancelEffect[]> {
  const head = await lockJwDcOutwardForCancel(tx, companyId, id, false);
  if (!head || head.deletedAt != null) return [];
  const lines = await readCancelLines(tx, companyId, id);
  const out: CancelEffect[] = [];
  // Stock: one row per item (a challan may send the same item on two lines).
  const byItem = new Map<string, { code: string; qty: number }>();
  for (const l of lines) {
    if (!l.itemId) continue;
    const prev = byItem.get(l.itemId);
    byItem.set(l.itemId, { code: l.itemCodeText, qty: roundQty((prev?.qty ?? 0) + l.sentQty) });
  }
  for (const v of byItem.values()) {
    out.push({ kind: 'stock', text: `${v.code} ${v.qty} comes back into stock`, qty: v.qty });
  }
  // Reopen: one row per PO line.
  const byPoLine = new Map<string, { poCode: string; poLineNo: number | null; qty: number }>();
  for (const l of lines) {
    if (!l.purchaseOrderLineId) continue;
    const prev = byPoLine.get(l.purchaseOrderLineId);
    byPoLine.set(l.purchaseOrderLineId, {
      poCode: l.poCode ?? 'PO',
      poLineNo: l.poLineNo,
      qty: roundQty((prev?.qty ?? 0) + l.sentQty),
    });
  }
  for (const v of byPoLine.values()) {
    const ln = v.poLineNo != null ? ` Ln ${v.poLineNo}` : '';
    out.push({ kind: 'reopen', text: `${v.poCode}${ln}: ${v.qty} can be sent again`, qty: v.qty });
  }
  return out;
}

/**
 * The ONE JW DC (outward) cancel writer, run only by an approved Cancel
 * Request (ADR-235). In-tx body, no rights check — the Cancel Request checks
 * the ticks.
 */
export async function cancelJwDcOutwardTx(
  tx: DbTransaction,
  companyId: string,
  id: string,
  reason: string,
  user: AuthContext,
): Promise<void> {
  const trimmed = (reason ?? '').trim();
  if (!trimmed) throw new ValidationError('Reason is required to cancel a JW DC.');

  // Header first (a receipt locks it too — createJwDcInward), then its lines,
  // then the PO lines in id order — the order a send takes them
  // (lockPoLinesForSend) — so a send on the same line queues behind this.
  const head = await lockJwDcOutwardForCancel(tx, companyId, id, true);
  if (!head) throw new NotFoundError('JW DC not found. Refresh the page.');
  if (head.deletedAt != null || head.cancelledAt != null) {
    throw new ConflictError(`${head.code} is already cancelled. Refresh the page.`);
  }
  await tx
    .select({ id: jwDcOutwardLines.id })
    .from(jwDcOutwardLines)
    .where(and(eq(jwDcOutwardLines.jwDcOutwardId, id), isNull(jwDcOutwardLines.deletedAt)))
    .orderBy(jwDcOutwardLines.id)
    .for('update');
  const lines = await readCancelLines(tx, companyId, id);
  const poLineIds = Array.from(
    new Set(lines.flatMap((l) => (l.purchaseOrderLineId ? [l.purchaseOrderLineId] : []))),
  );
  if (poLineIds.length > 0) {
    // Same lock as lockPoLinesForSend, without its "PO still orderable" check:
    // taking material back is right even when the PO is closing.
    await tx.execute(sql`
      SELECT pol.id
        FROM public.purchase_order_lines pol
       WHERE pol.company_id = ${companyId}::uuid
         AND pol.id = ANY(${sql.param(poLineIds)}::uuid[])
       ORDER BY pol.id
       FOR UPDATE
    `);
  }

  // The refusal rule, under the locks — before anything moves.
  const blockers = await jwDcOutwardCancelBlockers(tx, companyId, id);
  if (blockers.length > 0) {
    throw new ConflictError(blockerRefusal(head.code, blockers), { blockers });
  }

  // Put each line's stock back (item id order, so two cancels never cross).
  // The IST calendar day, as the other cancel reversals stamp it.
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const done: string[] = [];
  const stocked = lines
    .filter((l) => l.itemId && l.sentQty > 0)
    .sort((a, b) => a.itemId!.localeCompare(b.itemId!) || a.lineNo - b.lineNo);
  for (const l of stocked) {
    const mv = await postStockMove(tx, {
      companyId,
      itemId: l.itemId!,
      txnType: 'in',
      qty: l.sentQty,
      sourceType: 'jw_out',
      sourceRef: `${head.code} · ${l.itemCodeText} (cancel)`,
      remarks: `JW DC Outward cancelled · ${trimmed}`,
      txnDate: today,
      userId: user.id,
      itemCodeText: l.itemCodeText,
      guard: 'none',
    });
    done.push(`${l.itemCodeText} × ${l.sentQty} (stock ${mv.stockBefore} → ${mv.stockAfter})`);
  }

  // ONE stamp for header and lines: a cancelled challan's own lines are exactly
  // those whose deleted_at equals the header's. cancelled_at is the same instant.
  const stamp = softDeleteStamp(user);
  await tx
    .update(jwDcOutwardLines)
    .set({ ...stamp, updatedAt: stamp.deletedAt, updatedBy: user.id })
    .where(and(eq(jwDcOutwardLines.jwDcOutwardId, id), isNull(jwDcOutwardLines.deletedAt)));
  // §20.2 — cancel once: only a still-live header moves.
  const moved = await tx
    .update(jwDcOutward)
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
        eq(jwDcOutward.id, id),
        eq(jwDcOutward.companyId, companyId),
        isNull(jwDcOutward.deletedAt),
      ),
    )
    .returning({ id: jwDcOutward.id });
  if (moved.length === 0) {
    throw new ConflictError(
      `${head.code} has just been cancelled by someone else. Refresh the page.`,
    );
  }

  await emitActivityLog(
    tx,
    {
      action: ActivityAction.Cancel,
      entity: 'JwDcOutward',
      entityId: head.id,
      refId: head.code,
      qty: roundQty(lines.reduce((sum, l) => sum + l.sentQty, 0)),
      reason: trimmed,
      detail: `${head.code} cancelled` + (done.length > 0 ? ` — put back ${done.join(', ')}` : ''),
    },
    companyId,
    user,
  );
}
