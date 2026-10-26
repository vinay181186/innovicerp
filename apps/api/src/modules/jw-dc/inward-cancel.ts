// JW DC Receipt (inward) — Cancel (ADR-235 Phase C part 2). Only via an
// approved Cancel Request.
//
// Owner rule: a receipt cancels only while the Incoming QC of the GRN it raised
// (0172, jw_dc_inward.goods_receipt_note_id) is untouched. Cancelling the
// receipt cancels that GRN in the SAME transaction (cancelGrnTx with
// `viaReceipt`). Nothing entered stock — Incoming QC credits stock, and it has
// not run — so there is no stock to put back.
//
// The inward header and its live lines are stamped with ONE soft-delete stamp
// plus cancel_reason / cancelled_at (same instant) / cancelled_by (0221). The
// outward's "returned so far" figure (createJwDcInward's pending bound, the
// outward list / detail Returned column) and po-line-sent BACK all filter
// jw_dc_inward_lines.deleted_at, so the pieces read as At Vendor again with no
// other write.
//
// A receipt made before 0172 (no linked GRN) wrote 'jw_in' stock on its OK qty
// itself; reversing that is not built — it is refused.
//
// LOCK ORDER — the outward header first (createJwDcInward and the outward
// cancel take it first), then the inward header, its lines (id order), then
// cancelGrnTx's own order (GRN header → GRN lines → PO lines). PO lines are not
// locked ahead of the GRN: Incoming QC holds a GRN line and then touches its PO
// line, so taking the PO line first here could deadlock with it.

import { ActivityAction, roundQty, type CancelBlocker, type CancelEffect } from '@innovic/shared';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { jwDcInward, jwDcInwardLines } from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { softDeleteStamp } from '../../lib/audit-trail';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';
import { blockerRefusal } from '../cancel-requests/messages';
import { cancelGrnTx, grnCancelBlockers, lockGrnForCancel } from '../goods-receipt-notes/cancel';

export interface JwDcInwardCancelHead {
  id: string;
  code: string;
  jwDcOutwardId: string;
  outwardCode: string | null;
  goodsReceiptNoteId: string | null;
  deletedAt: unknown;
  cancelledAt: unknown;
}

async function readHead(
  tx: DbTransaction,
  companyId: string,
  id: string,
  forUpdate: boolean,
): Promise<JwDcInwardCancelHead | null> {
  const rows = (await tx.execute(sql`
    SELECT jdi.id, jdi.code, jdi.jw_dc_outward_id AS "jwDcOutwardId",
           COALESCE(jdo.code, jdi.dc_code_text) AS "outwardCode",
           jdi.goods_receipt_note_id AS "goodsReceiptNoteId",
           jdi.deleted_at AS "deletedAt", jdi.cancelled_at AS "cancelledAt"
      FROM public.jw_dc_inward jdi
      LEFT JOIN public.jw_dc_outward jdo ON jdo.id = jdi.jw_dc_outward_id
     WHERE jdi.id = ${id}::uuid AND jdi.company_id = ${companyId}::uuid
       AND (jdi.deleted_at IS NULL OR jdi.cancelled_at IS NOT NULL)
     ${forUpdate ? sql`FOR UPDATE OF jdi` : sql``}
  `)) as unknown as JwDcInwardCancelHead[];
  return rows[0] ?? null;
}

/** Read the JW DC receipt — cancelled ones included (a cancel stamps
 *  deleted_at). `forUpdate` locks the OUTWARD header first, then the receipt;
 *  the preview reads without a lock. null = not in this company, or deleted
 *  without a cancel. */
export async function lockJwDcInwardForCancel(
  tx: DbTransaction,
  companyId: string,
  id: string,
  forUpdate: boolean,
): Promise<JwDcInwardCancelHead | null> {
  const peek = await readHead(tx, companyId, id, false);
  if (!peek || !forUpdate) return peek;
  await tx.execute(sql`
    SELECT id FROM public.jw_dc_outward
     WHERE id = ${peek.jwDcOutwardId}::uuid AND company_id = ${companyId}::uuid
     FOR UPDATE
  `);
  return readHead(tx, companyId, id, true);
}

/**
 * THE JW DC receipt cancel refusal rule (one place — the worker under its
 * locks, the Cancel Request service and the preview all call it): its GRN's own
 * rules (viaReceipt), an unlinked older receipt, a GRN already gone, a staged
 * GRN edit.
 */
export async function jwDcInwardCancelBlockers(
  tx: DbTransaction,
  companyId: string,
  id: string,
): Promise<CancelBlocker[]> {
  const head = await lockJwDcInwardForCancel(tx, companyId, id, false);
  if (!head || head.deletedAt != null) return [];
  const href = `/jw-dc/${head.jwDcOutwardId}`;
  if (!head.goodsReceiptNoteId) {
    return [
      {
        docLabel: 'JW DC Receipt',
        docNo: head.code,
        href,
        reason: 'older receipt — its GRN is not linked, so it cannot be cancelled',
      },
    ];
  }
  const grn = await lockGrnForCancel(tx, companyId, head.goodsReceiptNoteId, false);
  if (!grn || grn.deletedAt != null) {
    return [
      {
        docLabel: 'GRN',
        docNo: grn?.code ?? 'GRN',
        href,
        reason: 'its GRN is already cancelled or deleted — report this to the administrator',
      },
    ];
  }
  const out: CancelBlocker[] = (
    await grnCancelBlockers(tx, companyId, grn.id, { viaReceipt: true })
  ).map((b) => ({ ...b, reason: `on its ${grn.code}: ${b.reason}` }));
  const staged = (await tx.execute(sql`
    SELECT 1 FROM public.document_edit_requests
     WHERE company_id = ${companyId}::uuid AND entity = 'GoodsReceiptNote'
       AND entity_id = ${grn.id}::uuid AND status = 'pending' AND deleted_at IS NULL
     LIMIT 1
  `)) as unknown as unknown[];
  if (staged.length > 0) {
    out.push({
      docLabel: 'GRN',
      docNo: grn.code,
      href: `/goods-receipt-notes/${grn.id}`,
      reason: 'it has an edit waiting for approval — decide it first',
    });
  }
  return out;
}

async function liveReceivedQty(tx: DbTransaction, companyId: string, id: string): Promise<number> {
  const rows = (await tx.execute(sql`
    SELECT COALESCE(SUM(received_qty), 0)::float8 AS qty
      FROM public.jw_dc_inward_lines
     WHERE jw_dc_inward_id = ${id}::uuid AND company_id = ${companyId}::uuid
       AND deleted_at IS NULL
  `)) as unknown as Array<{ qty: number }>;
  return roundQty(Number(rows[0]?.qty ?? 0));
}

/** What the cancel will do — shown before the user commits. */
export async function jwDcInwardCancelEffects(
  tx: DbTransaction,
  companyId: string,
  id: string,
): Promise<CancelEffect[]> {
  const head = await lockJwDcInwardForCancel(tx, companyId, id, false);
  if (!head || head.deletedAt != null) return [];
  const qty = await liveReceivedQty(tx, companyId, id);
  const out: CancelEffect[] = [
    {
      kind: 'reopen',
      text: `${head.outwardCode ?? 'The JW DC'}: ${qty} back to At Vendor`,
      qty,
    },
  ];
  if (head.goodsReceiptNoteId) {
    const grn = await lockGrnForCancel(tx, companyId, head.goodsReceiptNoteId, false);
    out.push({
      kind: 'note',
      text: `${grn?.code ?? 'Its GRN'} is cancelled with it — no stock moved`,
      qty: null,
    });
  }
  return out;
}

/**
 * The ONE JW DC receipt cancel writer, run only by an approved Cancel Request
 * (ADR-235), in the caller's transaction. No rights check — the Cancel Request
 * checks the ospdc_create ticks.
 */
export async function cancelJwDcInwardTx(
  tx: DbTransaction,
  companyId: string,
  id: string,
  reason: string,
  user: AuthContext,
): Promise<void> {
  const trimmed = (reason ?? '').trim();
  if (!trimmed) throw new ValidationError('Reason is required to cancel a JW DC receipt.');

  const head = await lockJwDcInwardForCancel(tx, companyId, id, true);
  if (!head) throw new NotFoundError('JW DC receipt not found. Refresh the page.');
  if (head.deletedAt != null || head.cancelledAt != null) {
    throw new ConflictError(`${head.code} is already cancelled. Refresh the page.`);
  }
  await tx
    .select({ id: jwDcInwardLines.id })
    .from(jwDcInwardLines)
    .where(
      and(
        eq(jwDcInwardLines.jwDcInwardId, id),
        eq(jwDcInwardLines.companyId, companyId),
        isNull(jwDcInwardLines.deletedAt),
      ),
    )
    .orderBy(asc(jwDcInwardLines.id))
    .for('update');

  // The refusal rule, under the locks — before anything moves.
  const blockers = await jwDcInwardCancelBlockers(tx, companyId, id);
  if (blockers.length > 0) {
    throw new ConflictError(blockerRefusal(head.code, blockers), { blockers });
  }
  const grnId = head.goodsReceiptNoteId;
  if (!grnId) throw new ConflictError(`${head.code}: its GRN is not linked.`);
  const qty = await liveReceivedQty(tx, companyId, id);

  // 1. Its GRN goes with it (PO-line received qty / PO status recalculated there).
  const grn = await cancelGrnTx(tx, companyId, grnId, trimmed, user, { viaReceipt: true });

  // 2. ONE stamp for the inward header and its lines.
  const stamp = softDeleteStamp(user);
  await tx
    .update(jwDcInwardLines)
    .set({ ...stamp, updatedAt: stamp.deletedAt, updatedBy: user.id })
    .where(
      and(
        eq(jwDcInwardLines.jwDcInwardId, id),
        eq(jwDcInwardLines.companyId, companyId),
        isNull(jwDcInwardLines.deletedAt),
      ),
    );
  // §20.2 — cancel once: only a still-live receipt moves.
  const moved = await tx
    .update(jwDcInward)
    .set({
      ...stamp,
      cancelReason: trimmed,
      cancelledAt: stamp.deletedAt,
      cancelledBy: user.id,
      updatedAt: stamp.deletedAt,
      updatedBy: user.id,
    })
    .where(
      and(eq(jwDcInward.id, id), eq(jwDcInward.companyId, companyId), isNull(jwDcInward.deletedAt)),
    )
    .returning({ id: jwDcInward.id });
  if (moved.length === 0) {
    throw new ConflictError(
      `${head.code} has just been cancelled by someone else. Refresh the page.`,
    );
  }

  // 3. History: the CANCEL on the receipt, a REVERSE on the outward challan.
  const outCode = head.outwardCode ?? 'JW DC';
  await emitActivityLog(
    tx,
    {
      action: ActivityAction.Cancel,
      entity: 'JwDcInward',
      entityId: id,
      refId: head.code,
      qty,
      reason: trimmed,
      detail: `${head.code} cancelled — ${qty} back to At Vendor on ${outCode}; ${grn.code} cancelled with it, no stock moved`,
    },
    companyId,
    user,
  );
  await emitActivityLog(
    tx,
    {
      action: ActivityAction.Reverse,
      entity: 'JwDcOutward',
      entityId: head.jwDcOutwardId,
      refId: outCode,
      qty,
      reason: trimmed,
      detail: `${outCode} — receipt ${head.code} cancelled (${qty} back to At Vendor)`,
    },
    companyId,
    user,
  );
}
