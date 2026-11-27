// ADR-324 line undo (P1) — party_grn_line_qc, Reverse QC on ONE Party GRN
// line (doc_id = party_grn_lines.id). Lock order and the parent-edit rule:
// see ./line-cancel-common.ts.

import {
  ActivityAction,
  type CancelBlocker,
  type CancelEffect,
  NC_DISPOSITION_LABELS,
  NC_STATUS_LABELS,
  type NcDisposition,
} from '@innovic/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { partyGrnLines } from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { ConflictError, ValidationError } from '../../lib/errors';
import { lockJwLine } from '../../lib/jw-line-state';
import { postPartyStockMove } from '../../lib/party-stock-ledger';
import { labelOf } from '../../lib/status-labels';
import { emitActivityLog } from '../activity-log/service';
import { blockerRefusal } from '../cancel-requests/messages';
import type { CancelHandler } from '../cancel-requests/registry';
import { cancelLineOf, commonBlockers, lockLine, mustLock } from './line-cancel-common';
import { isQcUntouched } from './qc-state';
import { partyGrnCancelBlockers } from './service';

// ─── Reverse QC ─────────────────────────────────────────────────────────────

async function lineQcBlockers(
  tx: DbTransaction,
  companyId: string,
  lineId: string,
): Promise<CancelBlocker[]> {
  const l = await mustLock(tx, companyId, lineId, false);
  const head = await commonBlockers(tx, companyId, l);
  if (head.length > 0) return head;
  const href = `/party-grn/${l.partyGrnId}`;
  if (l.salesOrderId) {
    return [
      {
        docLabel: 'Party GRN',
        docNo: l.grnCode,
        href,
        reason: 'Reverse QC is available for JWSO Party GRNs only for now',
      },
    ];
  }
  const line = await cancelLineOf(tx, companyId, l);
  if (!line || isQcUntouched(line)) {
    return [{ docLabel: 'Party GRN line', docNo: l.code, href, reason: 'nothing to reverse — no QC is recorded' }];
  }
  const out: CancelBlocker[] = [];
  const decided = (await tx.execute(sql`
    SELECT id, code, disposition::text AS disposition
      FROM public.nc_register
     WHERE party_grn_line_id = ${l.id}::uuid AND company_id = ${companyId}::uuid
       AND deleted_at IS NULL AND status <> 'pending'
       -- Closed by a cancel / an earlier Reverse QC (no decision) is not one.
       AND disposition IS NOT NULL
     ORDER BY code
  `)) as unknown as Array<{ id: string; code: string; disposition: string | null }>;
  for (const nc of decided) {
    const what = nc.disposition
      ? labelOf(NC_DISPOSITION_LABELS, nc.disposition as NcDisposition)
      : 'a decision';
    out.push({
      docLabel: 'NC',
      docNo: nc.code,
      href: `/nc-register/${nc.id}`,
      reason: `${nc.code} has a decision (${what}) — undo the decision first`,
    });
  }
  out.push(...(await partyGrnCancelBlockers(tx, companyId, l.partyGrnId, [l.id])));
  return out;
}

async function lineQcEffects(
  tx: DbTransaction,
  companyId: string,
  lineId: string,
): Promise<CancelEffect[]> {
  const l = await mustLock(tx, companyId, lineId, false);
  const line = await cancelLineOf(tx, companyId, l);
  if (!line) return [];
  const out: CancelEffect[] = [];
  if (line.acceptedQty > 0 && line.partyMaterialId != null) {
    out.push({
      kind: 'stock',
      text: `${l.code} ${line.rmCode} — ${line.acceptedQty} leaves the customer material register`,
      qty: -line.acceptedQty,
    });
  }
  out.push({
    kind: 'note',
    text: `${l.code} goes back to waiting for Incoming QC (${line.receivedQty} pcs)`,
    qty: null,
  });
  const ncs = (await tx.execute(sql`
    SELECT code FROM public.nc_register
     WHERE party_grn_line_id = ${l.id}::uuid AND company_id = ${companyId}::uuid
       AND deleted_at IS NULL AND status = 'pending'
     ORDER BY code
  `)) as unknown as Array<{ code: string }>;
  for (const nc of ncs) out.push({ kind: 'note', text: `${nc.code} will be closed`, qty: null });
  return out;
}

/** The Reverse QC worker — in the approver's transaction, after lock(true)
 *  and the blockers. Re-checks the refusal rule under the JWSO line lock. */
export async function reversePartyGrnLineQcTx(
  tx: DbTransaction,
  companyId: string,
  lineId: string,
  reason: string,
  user: AuthContext,
): Promise<void> {
  const trimmed = (reason ?? '').trim();
  if (!trimmed) throw new ValidationError('Reason is required to reverse QC.');
  const l = await mustLock(tx, companyId, lineId, true);
  if (l.grnDead || l.lineDead) {
    throw new ConflictError(`${l.code} is already cancelled. Refresh the page.`);
  }
  const ncs = (await tx.execute(sql`
    SELECT id, code, status::text AS status, rejected_qty::int AS "rejectedQty"
      FROM public.nc_register
     WHERE party_grn_line_id = ${l.id}::uuid AND company_id = ${companyId}::uuid
       AND deleted_at IS NULL AND status <> 'closed'
     ORDER BY id
     FOR UPDATE
  `)) as unknown as Array<{ id: string; code: string; status: string; rejectedQty: number }>;
  const line = await cancelLineOf(tx, companyId, l);
  if (!line) throw new ConflictError(`${l.code} was removed a moment ago. Refresh the page.`);
  if (line.jwLineId) await lockJwLine(tx, companyId, line.jwLineId);

  // The refusal rule again, under the JWSO line lock — before anything moves.
  const blockers = await lineQcBlockers(tx, companyId, lineId);
  if (blockers.length > 0) throw new ConflictError(blockerRefusal(l.code, blockers), { blockers });

  const accepted = line.acceptedQty;
  if (accepted > 0 && line.partyMaterialId != null) {
    await postPartyStockMove(tx, {
      companyId,
      partyMaterialId: line.partyMaterialId,
      jwLineId: line.jwLineId,
      salesOrderId: null,
      movement: 'reversal',
      direction: 'out',
      qty: accepted,
      sourceDocType: 'party_grn',
      sourceDocId: l.partyGrnId,
      remarks: `${l.code} QC reversed: ${trimmed}`,
      userId: user.id,
      qtyLabel: 'Reversal Qty',
    });
    const upd = (await tx.execute(sql`
      UPDATE public.party_materials
         SET received_qty = received_qty - ${accepted}, updated_at = now(), updated_by = ${user.id}::uuid
       WHERE id = ${line.partyMaterialId}::uuid AND received_qty >= ${accepted}
      RETURNING id
    `)) as unknown as Array<{ id: string }>;
    if (upd.length === 0) {
      throw new ConflictError(
        `Cannot reverse QC on ${l.code}: the received total of its customer material is lower than ` +
          `${accepted} — the figures disagree. Ask an admin to check the customer material register.`,
      );
    }
  }

  // The line's still-open NCs close as the whole-GRN cancel closes them (only
  // pending ones can be here — a decided NC is a blocker above).
  const ncNote = `${l.code} QC reversed`;
  for (const nc of ncs) {
    const closed = (await tx.execute(sql`
      UPDATE public.nc_register
         SET status = 'closed',
             failed_qty = rejected_qty - cleared_qty,
             disposition_remarks = ${ncNote},
             closed_at = now(), closed_by = ${user.id}::uuid,
             updated_at = now(), updated_by = ${user.id}::uuid
       WHERE id = ${nc.id}::uuid AND status::text = ${nc.status} AND deleted_at IS NULL
      RETURNING id
    `)) as unknown as Array<{ id: string }>;
    if (closed.length === 0) {
      throw new ConflictError(`NC ${nc.code} changed a moment ago. Refresh the page.`);
    }
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Close,
        entity: 'NonConformance',
        entityId: nc.id,
        refId: nc.code,
        qty: nc.rejectedQty,
        changes: [
          {
            field: 'status',
            label: 'Status',
            before: labelOf(NC_STATUS_LABELS, nc.status),
            after: labelOf(NC_STATUS_LABELS, 'closed'),
          },
        ],
        detail: `${nc.code} — Closed: ${ncNote}`,
      },
      companyId,
      user,
    );
  }

  // §20.2 — reset only what was read; 0 rows = QC moved under us.
  const reset = await tx
    .update(partyGrnLines)
    .set({
      acceptedQty: 0,
      rejectedQty: 0,
      qcAt: null,
      qcBy: null,
      qcRemarks: null,
      rejectReason: null,
      updatedAt: new Date(),
      updatedBy: user.id,
    })
    .where(
      and(
        eq(partyGrnLines.id, l.id),
        eq(partyGrnLines.acceptedQty, line.acceptedQty),
        eq(partyGrnLines.rejectedQty, line.rejectedQty),
        isNull(partyGrnLines.deletedAt),
      ),
    )
    .returning({ id: partyGrnLines.id });
  if (reset.length === 0) {
    throw new ConflictError(
      `${l.code} changed a moment ago (its accepted / deviated qty is no longer ` +
        `${line.acceptedQty} / ${line.rejectedQty}). Refresh the page.`,
    );
  }

  await tx.execute(sql`
    UPDATE public.party_grn SET updated_at = now(), updated_by = ${user.id}::uuid
     WHERE id = ${l.partyGrnId}::uuid
  `);
  await emitActivityLog(
    tx,
    {
      action: ActivityAction.Reverse,
      entity: 'PartyGrn',
      entityId: l.partyGrnId,
      refId: l.grnCode,
      lineRef: `Line ${l.lineNo}`,
      qty: accepted,
      reason: trimmed,
      detail:
        `${l.code} QC reversed — ${trimmed}` +
        (ncs.length > 0 ? `; closed ${ncs.map((n) => n.code).join(', ')}` : ''),
    },
    companyId,
    user,
  );
}

export const partyGrnLineQcCancelHandler: CancelHandler = {
  docType: 'party_grn_line_qc',
  // The parent GRN's staged edit is checked in blockers (doc_id is the line).
  editEntity: null,
  async lock(tx, companyId, docId, forUpdate) {
    const l = await lockLine(tx, companyId, docId, forUpdate);
    return l ? { code: l.code, cancelled: l.grnDead || l.lineDead } : null;
  },
  blockers: lineQcBlockers,
  effects: lineQcEffects,
  async run(tx, companyId, docId, reason, actor) {
    await reversePartyGrnLineQcTx(tx, companyId, docId, reason, actor);
  },
};
