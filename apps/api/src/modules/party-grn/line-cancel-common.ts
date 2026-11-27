// ADR-324 line undo (P1) — two Cancel Request types on ONE Party GRN line
// (doc_id = party_grn_lines.id, doc code "PGRN-xxxxx Ln N"):
//
//   party_grn_line_qc — Reverse QC: what Incoming QC booked on the line is
//     taken back. The accepted pieces leave the customer material register
//     (the one ledger writer, postPartyStockMove — the same reversal / out the
//     whole-GRN cancel posts), party_materials.received_qty goes down, the
//     line's PENDING NCs are closed as the whole-GRN cancel closes them, and the
//     line is back to "waiting for QC" (accepted = rejected = 0, qc_* NULL).
//     Refused while an NC on the line has a decision, and by the line-filtered
//     whole-GRN refusal rule (deviated pieces sent back, accepted pieces issued
//     or returned).
//   party_grn_line — Remove line (one-step, Party GRN Edit tick): soft-deletes
//     a line nothing was inspected on. No stock moves.
//
// LOCK ORDER = cancelPartyGrnTx's: header → the line's NCs → the line → the
// JWSO line → the material (postPartyStockMove). lock(forUpdate) takes the
// first three, run() the last two. Incoming QC takes header → JWSO line →
// line; both start at the header, so they queue there.
//
// A pending staged edit of the PARENT Party GRN blocks both: the registry's
// editEntity check keys on doc_id (the line id), so blockers() checks the
// parent explicitly (editEntity is null here).

//
// This file: the shared lock + blocker pieces of both handlers
// (./line-qc-reverse-handler.ts, ./line-remove-handler.ts).

import type { CancelBlocker } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { DbTransaction } from '../../db/with-user-context';
import { NotFoundError } from '../../lib/errors';
import { partyGrnCancelLines } from './service';

export interface LockedLine {
  id: string;
  lineNo: number;
  partyGrnId: string;
  grnCode: string;
  salesOrderId: string | null;
  grnDead: boolean;
  lineDead: boolean;
  code: string;
}

/** Read the line + its header. `forUpdate`: header FOR UPDATE, then the
 *  line's live NCs, then the line (the cancelPartyGrnTx order). */
export async function lockLine(
  tx: DbTransaction,
  companyId: string,
  lineId: string,
  forUpdate: boolean,
): Promise<LockedLine | null> {
  // The header id first, without a lock (the header is locked before the line).
  const peek = (await tx.execute(sql`
    SELECT party_grn_id AS "partyGrnId" FROM public.party_grn_lines
     WHERE id = ${lineId}::uuid AND company_id = ${companyId}::uuid
  `)) as unknown as Array<{ partyGrnId: string }>;
  const grnId = peek[0]?.partyGrnId;
  if (!grnId) return null;
  const head = (await tx.execute(sql`
    SELECT id, code, sales_order_id AS "salesOrderId",
           (deleted_at IS NOT NULL OR cancelled_at IS NOT NULL) AS dead
      FROM public.party_grn
     WHERE id = ${grnId}::uuid AND company_id = ${companyId}::uuid
     ${forUpdate ? sql`FOR UPDATE` : sql``}
  `)) as unknown as Array<{ id: string; code: string; salesOrderId: string | null; dead: boolean }>;
  const h = head[0];
  if (!h) return null;
  if (forUpdate) {
    await tx.execute(sql`
      SELECT id FROM public.nc_register
       WHERE party_grn_line_id = ${lineId}::uuid AND company_id = ${companyId}::uuid
         AND deleted_at IS NULL AND status <> 'closed'
       ORDER BY id
       FOR UPDATE
    `);
  }
  const line = (await tx.execute(sql`
    SELECT id, line_no AS "lineNo", (deleted_at IS NOT NULL) AS dead
      FROM public.party_grn_lines
     WHERE id = ${lineId}::uuid AND party_grn_id = ${h.id}::uuid
     ${forUpdate ? sql`FOR UPDATE` : sql``}
  `)) as unknown as Array<{ id: string; lineNo: number; dead: boolean }>;
  const l = line[0];
  if (!l) return null;
  return {
    id: l.id,
    lineNo: Number(l.lineNo),
    partyGrnId: h.id,
    grnCode: h.code,
    salesOrderId: h.salesOrderId,
    grnDead: Boolean(h.dead),
    lineDead: Boolean(l.dead),
    code: `${h.code} Ln ${Number(l.lineNo)}`,
  };
}

export async function mustLock(
  tx: DbTransaction,
  companyId: string,
  lineId: string,
  forUpdate: boolean,
) {
  const l = await lockLine(tx, companyId, lineId, forUpdate);
  if (!l) throw new NotFoundError('Party GRN line not found. Refresh the page.');
  return l;
}

/** One live line of the GRN as the whole-GRN cancel reads it. */
export async function cancelLineOf(tx: DbTransaction, companyId: string, l: LockedLine) {
  const rows = await partyGrnCancelLines(tx, companyId, l.partyGrnId, [l.id]);
  return rows[0] ?? null;
}

/** Shared head of both blocker lists: GRN cancelled, line gone, staged edit. */
export async function commonBlockers(
  tx: DbTransaction,
  companyId: string,
  l: LockedLine,
): Promise<CancelBlocker[]> {
  const href = `/party-grn/${l.partyGrnId}`;
  if (l.grnDead) {
    return [{ docLabel: 'Party GRN', docNo: l.grnCode, href, reason: 'it is cancelled' }];
  }
  if (l.lineDead) {
    return [{ docLabel: 'Party GRN line', docNo: l.code, href, reason: 'it was removed' }];
  }
  const staged = (await tx.execute(sql`
    SELECT 1 FROM public.document_edit_requests
     WHERE company_id = ${companyId}::uuid AND entity = 'PartyGrn'
       AND entity_id = ${l.partyGrnId}::uuid AND status = 'pending' AND deleted_at IS NULL
     LIMIT 1
  `)) as unknown as unknown[];
  // ADR-324 — not while a cancel of the whole Party GRN waits.
  const whole = (await tx.execute(sql`
    SELECT doc_code AS "docCode" FROM public.cancel_requests
     WHERE company_id = ${companyId}::uuid AND doc_type = 'party_grn'
       AND doc_id = ${l.partyGrnId}::uuid AND status = 'pending' AND deleted_at IS NULL
     LIMIT 1
  `)) as unknown as Array<{ docCode: string }>;
  if (whole[0]) {
    return [
      {
        docLabel: 'Party GRN',
        docNo: whole[0].docCode,
        href,
        reason: 'has a cancel request pending — decide it first',
      },
    ];
  }
  if (staged.length > 0) {
    return [
      {
        docLabel: 'Party GRN',
        docNo: l.grnCode,
        href,
        reason: 'an edit is waiting for approval — decide it first',
      },
    ];
  }
  return [];
}
