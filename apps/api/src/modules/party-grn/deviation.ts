// ADR-247 — the ONE writer for "Use As Is" on customer material deviated at
// Party GRN Incoming QC. Called by the NC disposition (nc-register cascades)
// inside its transaction; it never decides the NC itself.
//
// The pieces move on the Party GRN line from Deviated to Accepted (accepted
// += qty, rejected −= qty — accepted + rejected is unchanged, so the 0233
// CHECK accepted + rejected <= received and rejected_returned ≤ rejected hold), then enter the customer-material
// register exactly as an Incoming QC accept does: postPartyStockMove
// receive/in carrying the JWSO line, and party_materials.received_qty += qty.
// Lock order matches a Customer Material Return: the JWSO line FIRST, then the
// Party GRN line.
//
// bookPartyAccepted (below) is the ONE writer of "accepted customer material"
// (CLAUDE.md §20.1): the order cap, the register post and received_qty. Both
// Incoming QC (./qc.ts) and Use As Is call it.

import { ActivityAction } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { type LockedJwLine, lockJwLine } from '../../lib/jw-line-state';
import { postPartyStockMove } from '../../lib/party-stock-ledger';
import { emitActivityLog } from '../activity-log/service';
import { assertNoPendingCancel } from '../cancel-requests/pending-guard';

export async function applyPartyGrnUseAsIs(
  tx: DbTransaction,
  input: { companyId: string; partyGrnLineId: string; qty: number; ncCode: string },
  user: AuthContext,
): Promise<void> {
  const { companyId, partyGrnLineId, qty, ncCode } = input;
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new ValidationError(`${ncCode}: Use As Is qty must be a whole number above 0.`);
  }

  // 1) Which JWSO line — read without a lock, so the JWSO line can be locked first.
  const peek = (await tx.execute(sql`
    SELECT pgl.jw_line_id AS "jwLineId"
      FROM public.party_grn_lines pgl
      JOIN public.party_grn pg ON pg.id = pgl.party_grn_id AND pg.deleted_at IS NULL
     WHERE pgl.id = ${partyGrnLineId}::uuid
       AND pgl.company_id = ${companyId}::uuid
       AND pgl.deleted_at IS NULL
  `)) as unknown as Array<{ jwLineId: string | null }>;
  const jwLineId = peek[0]?.jwLineId;
  if (!peek[0]) {
    throw new NotFoundError(
      `${ncCode}: its Party GRN line was not found — the Party GRN may have been cancelled. Refresh the page.`,
    );
  }
  if (!jwLineId) {
    throw new ConflictError(
      `${ncCode}: its Party GRN line has no JWSO line — it cannot be used as is.`,
    );
  }

  // 2) §20.3 — the JWSO line lock, then the Party GRN line.
  const jwLine = await lockJwLine(tx, companyId, jwLineId);
  const rows = (await tx.execute(sql`
    SELECT pgl.id, pgl.line_no AS "lineNo", pgl.jw_line_id AS "jwLineId",
           pgl.party_material_id AS "partyMaterialId",
           pgl.party_material_code_text AS "partyMaterialCodeText",
           pg.id AS "partyGrnId", pg.code AS "partyGrnCode"
      FROM public.party_grn_lines pgl
      JOIN public.party_grn pg ON pg.id = pgl.party_grn_id AND pg.deleted_at IS NULL
     WHERE pgl.id = ${partyGrnLineId}::uuid
       AND pgl.company_id = ${companyId}::uuid
       AND pgl.deleted_at IS NULL
     FOR UPDATE OF pgl
  `)) as unknown as Array<{
    id: string;
    lineNo: number;
    jwLineId: string | null;
    partyMaterialId: string | null;
    partyMaterialCodeText: string;
    partyGrnId: string;
    partyGrnCode: string;
  }>;
  const l = rows[0];
  if (!l || l.jwLineId !== jwLine.id) {
    throw new ConflictError(
      `${ncCode}: its Party GRN line changed a moment ago. Refresh the page.`,
    );
  }
  if (!l.partyMaterialId) {
    throw new ConflictError(
      `${ncCode}: ${l.partyGrnCode} Ln ${l.lineNo} has no customer material — it cannot be used as is.`,
    );
  }
  const at = `${l.partyGrnCode} Ln ${l.lineNo}`;
  // ADR-235 — Use As Is moves pieces into the register; not while a cancel of
  // the Party GRN waits (its preview would no longer say what it reverses).
  await assertNoPendingCancel(tx, 'party_grn', l.partyGrnId);

  // 3) §20.2 — conditional move Deviated → Accepted; only pieces still held.
  const moved = (await tx.execute(sql`
    UPDATE public.party_grn_lines
       SET accepted_qty = accepted_qty + ${qty},
           rejected_qty = rejected_qty - ${qty},
           updated_at = now(), updated_by = ${user.id}::uuid
     WHERE id = ${l.id}::uuid
       AND deleted_at IS NULL
       AND rejected_qty - rejected_returned_qty - ${qty} >= 0
    RETURNING id
  `)) as unknown as Array<{ id: string }>;
  if (moved.length === 0) {
    throw new ConflictError('These pieces were returned or used a moment ago. Refresh the page.');
  }

  // 4) Order cap + register post + received_qty — the one writer.
  await bookPartyAccepted(tx, {
    companyId,
    jwLine,
    partyMaterialId: l.partyMaterialId,
    partyGrnId: l.partyGrnId,
    qty,
    remarks: `${at} · ${l.partyMaterialCodeText} used as is (${ncCode})`,
    userId: user.id,
    overCapMessage: () =>
      `Using these ${qty} pcs would exceed Order Qty ${jwLine.orderQty} on ${jwLine.jwCode} Ln ${jwLine.lineNo} — ` +
      `the customer has already sent replacements. Return or scrap them instead.`,
  });

  await emitActivityLog(
    tx,
    {
      action: ActivityAction.QC,
      entity: 'PartyGrn',
      entityId: l.partyGrnId,
      refId: l.partyGrnCode,
      lineRef: `Line ${l.lineNo}`,
      qty,
      detail: `${ncCode}: ${qty} used as is`,
    },
    companyId,
    user,
  );
}

/**
 * THE writer of accepted customer material (§20.1). Call ONLY under
 * lockJwLine(jwLine), AFTER party_grn_lines.accepted_qty already holds `qty`:
 *  1) order cap — Σ accepted on the JWSO line's live Party GRN lines ≤ order
 *     qty, else ConflictError(overCapMessage(accepted));
 *  2) when qty > 0: the customer-material register "receive / in" carrying the
 *     JWSO line, and party_materials.received_qty += qty.
 */
export async function bookPartyAccepted(
  tx: DbTransaction,
  input: {
    companyId: string;
    jwLine: LockedJwLine;
    partyMaterialId: string;
    partyGrnId: string;
    qty: number;
    remarks: string;
    userId: string;
    overCapMessage: (accepted: number) => string;
  },
): Promise<void> {
  const { companyId, jwLine, partyMaterialId, qty, userId } = input;
  const acc = (await tx.execute(sql`
    SELECT COALESCE(SUM(pgl.accepted_qty), 0)::int AS accepted
      FROM public.party_grn_lines pgl
      JOIN public.party_grn pg ON pg.id = pgl.party_grn_id AND pg.deleted_at IS NULL
     WHERE pgl.jw_line_id = ${jwLine.id}::uuid AND pgl.deleted_at IS NULL
  `)) as unknown as Array<{ accepted: number }>;
  const accepted = Number(acc[0]?.accepted ?? 0);
  if (accepted > jwLine.orderQty) {
    throw new ConflictError(input.overCapMessage(accepted));
  }
  if (qty <= 0) return;

  await postPartyStockMove(tx, {
    companyId,
    partyMaterialId,
    jwLineId: jwLine.id,
    movement: 'receive',
    direction: 'in',
    qty,
    sourceDocType: 'party_grn',
    sourceDocId: input.partyGrnId,
    remarks: input.remarks,
    userId,
    qtyLabel: 'Accepted Qty',
  });
  await tx.execute(sql`
    UPDATE public.party_materials
       SET received_qty = received_qty + ${qty}, updated_at = now(),
           updated_by = ${userId}::uuid
     WHERE id = ${partyMaterialId}::uuid
  `);
}
