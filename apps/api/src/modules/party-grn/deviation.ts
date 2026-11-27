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
import { lockSoRow } from '../../lib/assembly-parts';
import { readSoCustomerParts } from '../../lib/party-so-parts';
import { emitActivityLog } from '../activity-log/service';
import { assertNoPendingCancel } from '../cancel-requests/pending-guard';
import { jwLineRegisterBalance } from './service';

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
    SELECT pgl.jw_line_id AS "jwLineId", pg.sales_order_id AS "salesOrderId"
      FROM public.party_grn_lines pgl
      JOIN public.party_grn pg ON pg.id = pgl.party_grn_id AND pg.deleted_at IS NULL
     WHERE pgl.id = ${partyGrnLineId}::uuid
       AND pgl.company_id = ${companyId}::uuid
       AND pgl.deleted_at IS NULL
  `)) as unknown as Array<{ jwLineId: string | null; salesOrderId: string | null }>;
  const jwLineId = peek[0]?.jwLineId;
  // ADR-307: an Equipment SO GRN line has no JWSO line — its SO is the parent.
  const salesOrderId = peek[0]?.salesOrderId ?? null;
  if (!peek[0]) {
    throw new NotFoundError(
      `${ncCode}: its Party GRN line was not found — the Party GRN may have been cancelled. Refresh the page.`,
    );
  }
  if (!jwLineId && !salesOrderId) {
    throw new ConflictError(
      `${ncCode}: its Party GRN line has no JWSO line — it cannot be used as is.`,
    );
  }

  // 2) §20.3 — the JWSO line lock, then the Party GRN line.
  // ADR-307: SO GRN → the SO row lock instead (NC → SO → GRN line → party
  // material; the header is never locked here — SO-GRN lock order, so-grn.ts).
  const jwLine = jwLineId ? await lockJwLine(tx, companyId, jwLineId) : null;
  if (!jwLine && salesOrderId) await lockSoRow(tx, companyId, salesOrderId);
  const rows = (await tx.execute(sql`
    SELECT pgl.id, pgl.line_no AS "lineNo", pgl.jw_line_id AS "jwLineId",
           pgl.party_material_id AS "partyMaterialId",
           pgl.party_material_code_text AS "partyMaterialCodeText",
           -- Owner 2026-11-17: the remarks name the live -RM item code.
           COALESCE((SELECT COALESCE(ri.code, pm.item_code_text)
                       FROM public.party_materials pm
                       LEFT JOIN public.items ri ON ri.id = pm.item_id
                      WHERE pm.id = pgl.party_material_id),
                    pgl.party_material_code_text) AS "rmCode",
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
    rmCode: string;
    partyGrnId: string;
    partyGrnCode: string;
  }>;
  const l = rows[0];
  if (!l || l.jwLineId !== (jwLine?.id ?? null)) {
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
  // ADR-324 — nor while a Reverse QC of this line waits.
  await assertNoPendingCancel(tx, 'party_grn_line_qc', l.id);
  await assertNoPendingCancel(tx, 'party_grn_line', l.id);

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
    salesOrderId,
    partyMaterialId: l.partyMaterialId,
    partyGrnId: l.partyGrnId,
    qty,
    remarks: `${at} · ${l.rmCode} used as is (${ncCode})`,
    userId: user.id,
    overCapMessage: () =>
      `Using these ${qty} pcs would exceed Order Qty ${jwLine?.orderQty} on ${jwLine?.jwCode} Ln ${jwLine?.lineNo} — ` +
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
 * ADR-324 — the inverse of applyPartyGrnUseAsIs, run only by an approved
 * "Undo decision" (nc_disposition) request, inside its transaction, AFTER the
 * NC row is locked. Same lock order: the JWSO line, then the Party GRN line.
 * The `qty` used-as-is pieces go back from Accepted to Deviated on the line
 * (accepted −= qty, rejected += qty — the sum is unchanged), leave the
 * customer-material register (reversal / out carrying the JWSO line, the one
 * ledger writer) and party_materials.received_qty −= qty (conditional, no
 * clamp). Refused when the register of the JWSO line no longer holds them
 * (issued to a Job Card / returned) — the blocker names those documents.
 */
export async function undoPartyGrnUseAsIs(
  tx: DbTransaction,
  input: {
    companyId: string;
    partyGrnLineId: string;
    qty: number;
    ncCode: string;
    reason: string;
  },
  user: AuthContext,
): Promise<void> {
  const { companyId, partyGrnLineId, qty, ncCode } = input;
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new ConflictError(`${ncCode}: no Use As Is pieces to take back. Refresh the page.`);
  }
  const peek = (await tx.execute(sql`
    SELECT pgl.jw_line_id AS "jwLineId", pg.sales_order_id AS "salesOrderId"
      FROM public.party_grn_lines pgl
      JOIN public.party_grn pg ON pg.id = pgl.party_grn_id AND pg.deleted_at IS NULL
     WHERE pgl.id = ${partyGrnLineId}::uuid
       AND pgl.company_id = ${companyId}::uuid
       AND pgl.deleted_at IS NULL
  `)) as unknown as Array<{ jwLineId: string | null; salesOrderId: string | null }>;
  const jwLineId = peek[0]?.jwLineId ?? null;
  if (!peek[0]) {
    throw new NotFoundError(
      `${ncCode}: its Party GRN line was not found — the Party GRN may have been cancelled. Refresh the page.`,
    );
  }
  if (!jwLineId || peek[0].salesOrderId) {
    throw new ConflictError(
      `${ncCode}: Undo decision is available for JWSO customer material only for now.`,
    );
  }

  const jwLine = await lockJwLine(tx, companyId, jwLineId);
  const rows = (await tx.execute(sql`
    SELECT pgl.id, pgl.line_no AS "lineNo", pgl.jw_line_id AS "jwLineId",
           pgl.party_material_id AS "partyMaterialId",
           pgl.accepted_qty::int AS "acceptedQty",
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
    acceptedQty: number;
    partyGrnId: string;
    partyGrnCode: string;
  }>;
  const l = rows[0];
  if (!l || l.jwLineId !== jwLine.id || !l.partyMaterialId) {
    throw new ConflictError(
      `${ncCode}: its Party GRN line changed a moment ago. Refresh the page.`,
    );
  }
  const at = `${l.partyGrnCode} Ln ${l.lineNo}`;

  // Under the JWSO line lock: the register of this line must still hold them.
  const balance = await jwLineRegisterBalance(tx, jwLine.id, l.partyMaterialId);
  if (balance < qty) {
    throw new ConflictError(
      `${ncCode}: only ${balance} of ${at}'s customer material is left in the register — ` +
        `the ${qty} used as is were issued or returned. Undo those first.`,
    );
  }

  // §20.2 — conditional move Accepted → Deviated; only pieces still accepted.
  const moved = (await tx.execute(sql`
    UPDATE public.party_grn_lines
       SET accepted_qty = accepted_qty - ${qty},
           rejected_qty = rejected_qty + ${qty},
           updated_at = now(), updated_by = ${user.id}::uuid
     WHERE id = ${l.id}::uuid
       AND deleted_at IS NULL
       AND accepted_qty = ${l.acceptedQty}
       AND accepted_qty >= ${qty}
    RETURNING id
  `)) as unknown as Array<{ id: string }>;
  if (moved.length === 0) {
    throw new ConflictError(`${at} changed a moment ago. Refresh the page.`);
  }

  await postPartyStockMove(tx, {
    companyId,
    partyMaterialId: l.partyMaterialId,
    jwLineId: jwLine.id,
    salesOrderId: null,
    movement: 'reversal',
    direction: 'out',
    qty,
    sourceDocType: 'party_grn',
    sourceDocId: l.partyGrnId,
    remarks: `${at} · ${ncCode} Use As Is undone: ${input.reason}`,
    userId: user.id,
    qtyLabel: 'Reversal Qty',
  });
  const upd = (await tx.execute(sql`
    UPDATE public.party_materials
       SET received_qty = received_qty - ${qty}, updated_at = now(), updated_by = ${user.id}::uuid
     WHERE id = ${l.partyMaterialId}::uuid AND received_qty >= ${qty}
    RETURNING id
  `)) as unknown as Array<{ id: string }>;
  if (upd.length === 0) {
    throw new ConflictError(
      `${ncCode}: the received total of its customer material is lower than ${qty} — the figures ` +
        `disagree. Ask an admin to check the customer material register.`,
    );
  }

  await emitActivityLog(
    tx,
    {
      action: ActivityAction.QC,
      entity: 'PartyGrn',
      entityId: l.partyGrnId,
      refId: l.partyGrnCode,
      lineRef: `Line ${l.lineNo}`,
      qty,
      reason: input.reason,
      detail: `${ncCode}: Use As Is undone — ${qty} back to Deviated`,
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
    /** Null on an Equipment SO GRN (ADR-307) — then salesOrderId is set and
     *  the caller holds lockSoRow instead of lockJwLine. */
    jwLine: LockedJwLine | null;
    salesOrderId?: string | null;
    partyMaterialId: string;
    partyGrnId: string;
    qty: number;
    remarks: string;
    userId: string;
    overCapMessage: (accepted: number) => string;
  },
): Promise<void> {
  const { companyId, jwLine, partyMaterialId, qty, userId } = input;
  const salesOrderId = input.salesOrderId ?? null;
  if (!jwLine) {
    // ADR-307: cap Σ accepted for this customer part on the SO at its need.
    if (!salesOrderId) throw new ConflictError('This Party GRN line has no JWSO or SO.');
    const pmRow = (await tx.execute(sql`
      SELECT item_id AS "itemId" FROM public.party_materials WHERE id = ${partyMaterialId}::uuid
    `)) as unknown as Array<{ itemId: string | null }>;
    const itemId = pmRow[0]?.itemId ?? null;
    const part = itemId
      ? (await readSoCustomerParts(tx, companyId, salesOrderId)).get(itemId)
      : null;
    if (!part) {
      throw new ConflictError(
        'This customer part is no longer on the BOM of the SO as Party Supplied — it cannot be accepted.',
      );
    }
    if (part.figures.acceptedQty > part.figures.needQty) {
      throw new ConflictError(
        `${part.rmItemCode}: accepting ${qty} would take the SO to ${part.figures.acceptedQty} accepted ` +
          `against a need of ${part.figures.needQty}. Mark the extra pieces Deviated.`,
      );
    }
  } else {
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
  }
  if (qty <= 0) return;

  await postPartyStockMove(tx, {
    companyId,
    partyMaterialId,
    jwLineId: jwLine?.id ?? null,
    salesOrderId,
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
