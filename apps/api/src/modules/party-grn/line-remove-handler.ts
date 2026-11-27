// ADR-324 line undo (P1) — party_grn_line, Remove line (one-step, Party GRN
// Edit tick) on ONE Party GRN line nothing was inspected on (doc_id =
// party_grn_lines.id). No stock moves. Lock order and the parent-edit rule:
// see ./line-cancel-common.ts.

import { ActivityAction, type CancelBlocker, type CancelEffect } from '@innovic/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { partyGrnLines } from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { softDeleteStamp } from '../../lib/audit-trail';
import { ConflictError, ValidationError } from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';
import { blockerRefusal } from '../cancel-requests/messages';
import type { CancelHandler } from '../cancel-requests/registry';
import { cancelLineOf, commonBlockers, lockLine, mustLock } from './line-cancel-common';
import { isQcUntouched, qcUntouchedCond } from './qc-state';

// ─── Remove line ────────────────────────────────────────────────────────────

async function removeLineBlockers(
  tx: DbTransaction,
  companyId: string,
  lineId: string,
): Promise<CancelBlocker[]> {
  const l = await mustLock(tx, companyId, lineId, false);
  const head = await commonBlockers(tx, companyId, l);
  if (head.length > 0) return head;
  const href = `/party-grn/${l.partyGrnId}`;
  const line = await cancelLineOf(tx, companyId, l);
  const out: CancelBlocker[] = [];
  if (line && !isQcUntouched(line)) {
    out.push({
      docLabel: 'Party GRN line',
      docNo: l.code,
      href,
      reason: `QC is recorded on Ln ${l.lineNo} — Reverse QC first`,
    });
  }
  const live = (await tx.execute(sql`
    SELECT count(*)::int AS n FROM public.party_grn_lines
     WHERE party_grn_id = ${l.partyGrnId}::uuid AND deleted_at IS NULL
  `)) as unknown as Array<{ n: number }>;
  if (Number(live[0]?.n ?? 0) <= 1) {
    out.push({
      docLabel: 'Party GRN',
      docNo: l.grnCode,
      href,
      reason: `Ln ${l.lineNo} is the only line — Cancel the GRN instead`,
    });
  }
  return out;
}

async function removeLineEffects(
  tx: DbTransaction,
  companyId: string,
  lineId: string,
): Promise<CancelEffect[]> {
  const l = await mustLock(tx, companyId, lineId, false);
  const line = await cancelLineOf(tx, companyId, l);
  if (!line) return [];
  return [
    {
      kind: 'reopen',
      text: `${l.code} is removed — ${line.receivedQty} pcs can be received from the customer again`,
      qty: line.receivedQty,
    },
  ];
}

/** The Remove line worker — soft-deletes a QC-untouched line. No stock. */
export async function removePartyGrnLineTx(
  tx: DbTransaction,
  companyId: string,
  lineId: string,
  reason: string,
  user: AuthContext,
): Promise<void> {
  const trimmed = (reason ?? '').trim();
  if (!trimmed) throw new ValidationError('Reason is required to remove a line.');
  const l = await mustLock(tx, companyId, lineId, true);
  const blockers = await removeLineBlockers(tx, companyId, lineId);
  if (blockers.length > 0) throw new ConflictError(blockerRefusal(l.code, blockers), { blockers });
  const stamp = softDeleteStamp(user);
  const gone = await tx
    .update(partyGrnLines)
    .set({ ...stamp, updatedAt: stamp.deletedAt, updatedBy: user.id })
    .where(and(eq(partyGrnLines.id, l.id), isNull(partyGrnLines.deletedAt), qcUntouchedCond()))
    .returning({ id: partyGrnLines.id });
  if (gone.length === 0) {
    throw new ConflictError(
      `${l.code} changed a moment ago (QC was recorded or it was removed). Refresh the page.`,
    );
  }
  await tx.execute(sql`
    UPDATE public.party_grn SET updated_at = now(), updated_by = ${user.id}::uuid
     WHERE id = ${l.partyGrnId}::uuid
  `);
  await emitActivityLog(
    tx,
    {
      action: ActivityAction.Delete,
      entity: 'PartyGrn',
      entityId: l.partyGrnId,
      refId: l.grnCode,
      lineRef: `Line ${l.lineNo}`,
      reason: trimmed,
      detail: `${l.code} removed — ${trimmed}`,
    },
    companyId,
    user,
  );
}

export const partyGrnLineCancelHandler: CancelHandler = {
  docType: 'party_grn_line',
  editEntity: null,
  async lock(tx, companyId, docId, forUpdate) {
    const l = await lockLine(tx, companyId, docId, forUpdate);
    return l ? { code: l.code, cancelled: l.grnDead || l.lineDead } : null;
  },
  blockers: removeLineBlockers,
  effects: removeLineEffects,
  async run(tx, companyId, docId, reason, actor) {
    await removePartyGrnLineTx(tx, companyId, docId, reason, actor);
  },
};
