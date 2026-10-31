// ADR-203 (owner D4) — Incoming QC on a Party GRN, a SEPARATE step after the
// gate-in. Gated by the Incoming QC permission (qc_incoming · entry), not by
// the Party screens' own key.
//
// Per line: accepted + rejected = received, a reason when anything is rejected.
// The line is booked with a CONDITIONAL update (WHERE still pending — §20.2), so
// two QC users on the same line cannot both book it. Only the accepted qty is
// posted to the customer-material register (receive / in, carrying the JWSO
// line) through lib/party-stock-ledger, and party_materials.received_qty is
// raised by the same amount. ADR-247: deviated pieces raise a material NC on
// the line (nc-register/cascades autoCreatePartyGrnMaterialNc), in the same
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
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { lockJwLine } from '../../lib/jw-line-state';
import { emitActivityLog } from '../activity-log/service';
import { assertNoPendingCancel } from '../cancel-requests/pending-guard';
import { autoCreatePartyGrnMaterialNc } from '../nc-register/cascades';
import { userDisplayName } from '../nc-register/recovery';
import { bookPartyAccepted } from './deviation';
import { isPendingQc, loadPartyGrnDetail, requireCompany } from './service';

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
        qcAt: partyGrnLines.qcAt,
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
      if (!isPendingQc(l)) {
        throw new ConflictError(`${at} has already been through Incoming QC. Refresh the page.`);
      }
      if (q.acceptedQty + q.rejectedQty !== l.receivedQty) {
        throw new ValidationError(
          `${at}: Accepted (${q.acceptedQty}) + Deviated (${q.rejectedQty}) must equal Received (${l.receivedQty}).`,
        );
      }
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
      const jwLine = await lockJwLine(tx, companyId, l.jwLineId!);
      const at = `${head.code} Ln ${l.lineNo}`;
      const rmItem = q.rejectedQty > 0 ? (ncItemByLine.get(l.id) ?? null) : null;
      const qcRemarks = q.qcRemarks?.trim() || null;

      // §20.2: conditional — only a line still waiting for QC is booked.
      const booked = await tx
        .update(partyGrnLines)
        .set({
          acceptedQty: q.acceptedQty,
          rejectedQty: q.rejectedQty,
          rejectReason: q.rejectedQty > 0 ? (q.rejectReason ?? '').trim() : null,
          qcRemarks,
          qcBy: userId,
          qcAt: now,
          updatedAt: now,
          updatedBy: userId,
        })
        .where(
          and(
            eq(partyGrnLines.id, l.id),
            isNull(partyGrnLines.qcAt),
            eq(partyGrnLines.acceptedQty, 0),
            eq(partyGrnLines.rejectedQty, 0),
            isNull(partyGrnLines.deletedAt),
          ),
        )
        .returning({ id: partyGrnLines.id });
      if (booked.length === 0) {
        const who = (await tx.execute(sql`
          SELECT u.full_name AS name, pgl.qc_at AS "qcAt"
            FROM public.party_grn_lines pgl
            LEFT JOIN public.users u ON u.id = pgl.qc_by
           WHERE pgl.id = ${l.id}::uuid
        `)) as unknown as Array<{ name: string | null; qcAt: unknown }>;
        const by = who[0]?.name ? ` by ${who[0].name}` : '';
        throw new ConflictError(`${at} was QC'd${by} a moment ago. Refresh the page.`);
      }

      // Re-check the order cap under the JWSO line lock (Σ accepted on the
      // line, this booking included, ≤ order qty), then post the accepted
      // pieces — the one writer (./deviation.ts bookPartyAccepted).
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

      // ADR-247: deviated pieces → a material NC on this Party GRN line.
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
            reason: (q.rejectReason ?? '').trim(),
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
            `${l.partyMaterialCodeText} (${jwLine.jwCode} Ln ${jwLine.lineNo}) — received ${l.receivedQty}, ` +
            `${q.acceptedQty} accepted, ${q.rejectedQty} deviated` +
            (q.rejectedQty > 0 ? ` (${(q.rejectReason ?? '').trim()})` : '') +
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
