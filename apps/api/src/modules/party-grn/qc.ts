// ADR-203 (owner D4) — Incoming QC on a Party GRN, a SEPARATE step after the
// gate-in. Gated by the Incoming QC permission (qc_incoming · entry), not by
// the Party screens' own key.
//
// Partial QC (owner 2026-10-31, migration 0233): a line may be inspected in
// parts, like the Direct Purchase GRN — received 60, inspect 6 now, 54 later.
// Per inspection: 0 < accepted + rejected <= QC Pending Qty (received −
// accepted − rejected so far), a reason when anything is rejected. The line's
// accepted_qty / rejected_qty are running totals, ADDED to with a CONDITIONAL
// update (WHERE the new totals still fit in received — §20.2/§20.3), under the
// GRN header lock, then the JWSO line lock, then the line's own row lock, so
// two QC users on one line cannot overshoot it. Only THIS inspection's accepted
// qty is posted to the customer-material register (receive / in, carrying the
// JWSO line) through lib/party-stock-ledger, and party_materials.received_qty
// is raised by the same amount. ADR-247: this inspection's deviated pieces
// raise a material NC on the line (nc-register/cascades
// autoCreatePartyGrnMaterialNc), one NC per inspection, in the same
// transaction. While that NC is pending the pieces stay committed to the JWSO
// line; it is decided as Use As Is (./deviation.ts moves them into Accepted),
// Return to Customer (a Customer Material Return sends them back) or Scrap.

import {
  ActivityAction,
  type PartyGrnDetail,
  type PartyGrnQcInput,
  sfTodayIst,
} from '@innovic/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { partyGrnLines } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { lockJwLine } from '../../lib/jw-line-state';
import { emitActivityLog } from '../activity-log/service';
import { assertNoPendingCancel } from '../cancel-requests/pending-guard';
import { autoCreatePartyGrnMaterialNc } from '../nc-register/cascades';
import { userDisplayName } from '../nc-register/recovery';
import { bookPartyAccepted } from './deviation';
import { qcPendingQtyOf } from './qc-state';
import { loadPartyGrnDetail, requireCompany } from './service';

export async function qcPartyGrn(
  id: string,
  input: PartyGrnQcInput,
  user: AuthContext,
): Promise<PartyGrnDetail> {
  await requireFormAccess(user, 'qc_incoming', 'entry');
  const companyId = requireCompany(user);
  const userId = user.id;

  const ids = input.lines.map((l) => l.lineId);
  if (new Set(ids).size !== ids.length) {
    throw new ValidationError('A line appears twice in this QC entry. Enter each line once.');
  }

  return withUserContext(user, async (tx) => {
    // Lock the header (same order as cancel: header, then JWSO lines, then the
    // material) so a QC and a cancel of one GRN queue instead of crossing.
    const headRows = (await tx.execute(sql`
      SELECT id, code, deleted_at AS "deletedAt"
        FROM public.party_grn
       WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid
       FOR UPDATE
    `)) as unknown as Array<{ id: string; code: string; deletedAt: unknown }>;
    const head = headRows[0];
    if (!head) throw new NotFoundError('Party GRN not found. Refresh the page.');
    if (head.deletedAt != null) {
      throw new ConflictError(`${head.code} has been cancelled — it cannot be QC'd.`);
    }
    // ADR-235 — QC moves pieces into the register; not while a cancel waits.
    await assertNoPendingCancel(tx, 'party_grn', head.id);

    const rows = await tx
      .select({
        id: partyGrnLines.id,
        lineNo: partyGrnLines.lineNo,
        jwLineId: partyGrnLines.jwLineId,
        partyMaterialId: partyGrnLines.partyMaterialId,
        partyMaterialCodeText: partyGrnLines.partyMaterialCodeText,
        receivedQty: partyGrnLines.receivedQty,
        acceptedQty: partyGrnLines.acceptedQty,
        rejectedQty: partyGrnLines.rejectedQty,
      })
      .from(partyGrnLines)
      .where(
        and(
          eq(partyGrnLines.partyGrnId, id),
          eq(partyGrnLines.companyId, companyId),
          inArray(partyGrnLines.id, ids),
          isNull(partyGrnLines.deletedAt),
        ),
      );
    const byId = new Map(rows.map((r) => [r.id, r]));

    // Validate every entry before writing anything.
    for (const q of input.lines) {
      const l = byId.get(q.lineId);
      if (!l) {
        throw new ValidationError(
          `A line in this QC entry is not on ${head.code}. Refresh the page.`,
        );
      }
      const at = `${head.code} Ln ${l.lineNo}`;
      // Checked again under the JWSO-line + line locks below; this pass only
      // refuses early, before anything is written.
      assertFitsQcPending(at, l, q);
      if (q.rejectedQty > 0 && !(q.rejectReason ?? '').trim()) {
        throw new ValidationError(
          `${at}: give a deviation reason for the ${q.rejectedQty} deviated.`,
        );
      }
      if (!l.jwLineId || !l.partyMaterialId) {
        throw new ValidationError(
          `${at} has no JWSO line or customer material — it was booked before ADR-203 and cannot be QC'd here.`,
        );
      }
    }

    // Book the lines in JWSO-line order (deadlock-free with create/cancel).
    const ordered = [...input.lines].sort((a, b) => {
      const la = byId.get(a.lineId)!.jwLineId!;
      const lb = byId.get(b.lineId)!.jwLineId!;
      return la < lb ? -1 : la > lb ? 1 : 0;
    });

    // ADR-247: the NC for deviated pieces names the line's customer material
    // item — party_materials.item_id (what a Customer Material Return shows),
    // else the JWSO line's RM item. ONE read for every deviated line, before
    // anything is booked, so a line with neither refuses cleanly.
    const deviatedIds = input.lines.filter((q) => q.rejectedQty > 0).map((q) => q.lineId);
    const ncItemRows =
      deviatedIds.length > 0
        ? ((await tx.execute(sql`
            SELECT pgl.id AS "lineId", i.id, i.code, i.name
              FROM public.party_grn_lines pgl
              LEFT JOIN public.party_materials pm ON pm.id = pgl.party_material_id
              LEFT JOIN public.job_work_order_lines jwl ON jwl.id = pgl.jw_line_id
              JOIN public.items i
                ON i.id = COALESCE(pm.item_id, jwl.rm_item_id) AND i.company_id = ${companyId}::uuid
             WHERE pgl.company_id = ${companyId}::uuid
               AND pgl.id IN (${sql.join(
                 deviatedIds.map((d) => sql`${d}::uuid`),
                 sql`, `,
               )})
          `)) as unknown as Array<{
            lineId: string;
            id: string;
            code: string;
            name: string | null;
          }>)
        : [];
    const ncItemByLine = new Map(ncItemRows.map((r) => [r.lineId, r]));
    for (const lineId of deviatedIds) {
      if (!ncItemByLine.has(lineId)) {
        const l = byId.get(lineId)!;
        throw new ValidationError(
          `${head.code} Ln ${l.lineNo}: its customer material (${l.partyMaterialCodeText}) has no item, so ` +
            `the deviated pieces cannot be raised as an NC. Open and save the JWSO, then QC again.`,
        );
      }
    }

    const now = new Date();
    const qcDate = sfTodayIst(now);
    const reportedBy = userDisplayName(user);
    for (const q of ordered) {
      const l = byId.get(q.lineId)!;
      // §20.3 lock order: header (above) → JWSO line → the Party GRN line.
      const jwLine = await lockJwLine(tx, companyId, l.jwLineId!);
      const at = `${head.code} Ln ${l.lineNo}`;
      const locked = (
        await tx
          .select({
            receivedQty: partyGrnLines.receivedQty,
            acceptedQty: partyGrnLines.acceptedQty,
            rejectedQty: partyGrnLines.rejectedQty,
          })
          .from(partyGrnLines)
          .where(and(eq(partyGrnLines.id, l.id), isNull(partyGrnLines.deletedAt)))
          .for('update')
      )[0];
      if (!locked) throw new ConflictError(`${at} was removed a moment ago. Refresh the page.`);
      assertFitsQcPending(at, locked, q);
      const rmItem = q.rejectedQty > 0 ? (ncItemByLine.get(l.id) ?? null) : null;
      const qcRemarks = q.qcRemarks?.trim() || null;
      const rejectReason = (q.rejectReason ?? '').trim();
      const inspected = q.acceptedQty + q.rejectedQty;

      // §20.2: conditional — the running totals may never pass received.
      // Reason / remarks: this inspection's when given, else the line keeps
      // what an earlier inspection wrote.
      const booked = await tx
        .update(partyGrnLines)
        .set({
          acceptedQty: sql`${partyGrnLines.acceptedQty} + ${q.acceptedQty}`,
          rejectedQty: sql`${partyGrnLines.rejectedQty} + ${q.rejectedQty}`,
          ...(q.rejectedQty > 0 ? { rejectReason } : {}),
          ...(qcRemarks ? { qcRemarks } : {}),
          qcBy: userId,
          qcAt: now,
          updatedAt: now,
          updatedBy: userId,
        })
        .where(
          and(
            eq(partyGrnLines.id, l.id),
            isNull(partyGrnLines.deletedAt),
            sql`${partyGrnLines.acceptedQty} + ${partyGrnLines.rejectedQty} + ${inspected} <= ${partyGrnLines.receivedQty}`,
          ),
        )
        .returning({
          receivedQty: partyGrnLines.receivedQty,
          acceptedQty: partyGrnLines.acceptedQty,
          rejectedQty: partyGrnLines.rejectedQty,
        });
      const after = booked[0];
      if (!after) throw await bookedNowConflict(tx, at, l.id);
      const pendingAfter = qcPendingQtyOf(after);

      // Re-check the order cap under the JWSO line lock (Σ accepted on the
      // line, this booking included, ≤ order qty), then post THIS inspection's
      // accepted pieces — the one writer (./deviation.ts bookPartyAccepted).
      await bookPartyAccepted(tx, {
        companyId,
        jwLine,
        partyMaterialId: l.partyMaterialId!,
        partyGrnId: head.id,
        qty: q.acceptedQty,
        remarks: `${head.code} Ln ${l.lineNo} · ${l.partyMaterialCodeText} accepted at Incoming QC`,
        userId,
        overCapMessage: (accepted) =>
          `${at}: accepting ${q.acceptedQty} would take ${jwLine.jwCode} Ln ${jwLine.lineNo} to ` +
          `${accepted} accepted against an Order Qty of ${jwLine.orderQty}. Mark the extra pieces Deviated.`,
      });

      // ADR-247: this inspection's deviated pieces → one material NC.
      let ncCode: string | null = null;
      if (q.rejectedQty > 0 && rmItem) {
        const nc = await autoCreatePartyGrnMaterialNc(
          tx,
          {
            companyId,
            partyGrnLineId: l.id,
            partyGrnCode: head.code,
            lineNo: l.lineNo,
            itemId: rmItem.id,
            itemCodeText: rmItem.code,
            itemNameText: rmItem.name,
            rejectedQty: q.rejectedQty,
            ncDate: qcDate,
            reportedByText: reportedBy,
            reason: rejectReason,
            qcRemarks,
          },
          user,
        );
        ncCode = nc.code;
      }

      await emitActivityLog(
        tx,
        {
          action: ActivityAction.QC,
          entity: 'PartyGrn',
          entityId: head.id,
          refId: head.code,
          lineRef: `Line ${l.lineNo}`,
          qty: q.acceptedQty,
          detail:
            `${l.partyMaterialCodeText} (${jwLine.jwCode} Ln ${jwLine.lineNo}) — received ${after.receivedQty}, ` +
            `inspected ${inspected} (${q.acceptedQty} accepted, ${q.rejectedQty} deviated` +
            (q.rejectedQty > 0 ? `: ${rejectReason}` : '') +
            `), QC Pending ${pendingAfter}` +
            (ncCode ? ` — ${ncCode} raised` : '') +
            (qcRemarks ? ` — QC Remarks: ${qcRemarks}` : ''),
        },
        companyId,
        user,
      );
    }

    await tx.execute(sql`
      UPDATE public.party_grn SET updated_at = now(), updated_by = ${userId}::uuid
       WHERE id = ${head.id}::uuid
    `);

    return loadPartyGrnDetail(tx, companyId, head.id);
  });
}

/** 0 < accepted + deviated <= the line's QC Pending Qty (received − accepted −
 *  rejected so far). Nothing pending → 409 (someone finished it); too many →
 *  400. The schema already refuses accepted + deviated = 0. */
function assertFitsQcPending(
  at: string,
  line: { receivedQty: number; acceptedQty: number; rejectedQty: number },
  q: { acceptedQty: number; rejectedQty: number },
): void {
  const pending = qcPendingQtyOf(line);
  const inspected = q.acceptedQty + q.rejectedQty;
  if (pending <= 0) {
    throw new ConflictError(`${at} is already fully inspected. Refresh the page.`);
  }
  if (inspected <= 0) {
    throw new ValidationError(`${at}: enter the Accepted and/or Deviated qty.`);
  }
  if (inspected > pending) {
    throw new ValidationError(
      `${at}: Accepted + Deviated (${inspected}) cannot be more than QC Pending (${pending}).`,
    );
  }
}

/** The 409 when the conditional booking matched no row: what is booked now. */
async function bookedNowConflict(
  tx: DbTransaction,
  at: string,
  lineId: string,
): Promise<ConflictError> {
  const rows = (await tx.execute(sql`
    SELECT pgl.received_qty::int AS received, pgl.accepted_qty::int AS accepted,
           pgl.rejected_qty::int AS rejected, u.full_name AS name
      FROM public.party_grn_lines pgl
      LEFT JOIN public.users u ON u.id = pgl.qc_by
     WHERE pgl.id = ${lineId}::uuid
  `)) as unknown as Array<{
    received: number;
    accepted: number;
    rejected: number;
    name: string | null;
  }>;
  const c = rows[0];
  if (!c) return new ConflictError(`${at} was changed a moment ago. Refresh the page.`);
  const by = c.name ? ` (last by ${c.name})` : '';
  const pending = Math.max(0, c.received - c.accepted - c.rejected);
  return new ConflictError(
    `${at} now has ${c.accepted} accepted + ${c.rejected} deviated of ${c.received} received${by} — ` +
      `QC Pending ${pending}. Refresh the page.`,
  );
}
