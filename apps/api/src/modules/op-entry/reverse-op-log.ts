// Correct a wrong op entry — requirement 3.2 "Correct a wrong entry" (ADR-197,
// migration 0179).
//
// op_log is append-only: the wrong entry is NEVER edited or deleted. A new row
// is written with the SAME log_type and the NEGATIVE of its qty / reject_qty,
// naming the row it cancels (reversal_of_id) and why (reversal_reason). Every
// reader sums op_log, so the op's Done / QC figures, the next op's Available,
// the machine output (v_op_machine_output nets reversals since 0179) and the
// Daily Report all recalculate on their own. The original row stays on screen,
// marked as reversed.
//
// Refused when undoing the entry would leave something downstream standing on
// pieces that no longer exist:
//   - the entry is a Start marker, a reversal itself, already reversed, an NC
//     put-back (LOG-NC-…) or an Incoming QC mirror (those belong to their NC /
//     GRN and are corrected there);
//   - an NC was raised on the entry (its rework / scrap trail hangs off it);
//   - the pieces were already used by the next operation, or already
//     inspected on this op's own QC step;
//   - it is a QC entry on the Job Card's LAST op (the pieces went to stock, or
//     back into the parent card for a rework / repair child);
//   - the Job Card is complete or closed, or a Production Order on its chain is
//     closed, partly closed or short closed.
//
// Who: edit AND approve on Op Entry (Access Control). Admins bypass.

import { ActivityAction, activityReasonSchema, type OpLog, opSrNo } from '@innovic/shared';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { jcOps, jobCards, opLog } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { AuthorizationError, NotFoundError, ValidationError } from '../../lib/errors';
import { jobCardOrderChainCte } from '../../lib/production-order-link';
import { assertProductionOrderNotShortClosed } from '../../lib/production-order-stop';
import { emitActivityLog } from '../activity-log/service';
import { jcOpRef, logWhen } from './audit';
import { selectOpLogById } from './service';

/** POST /op-entry/op-log/:id/reverse — the reason is mandatory (REVERSE). */
export const reverseOpLogInputSchema = z.object({ reason: activityReasonSchema });
export type ReverseOpLogInput = z.infer<typeof reverseOpLogInputSchema>;

/** The prefix of a reversal row's log_no: REV-<the cancelled entry's log_no>. */
export const REVERSAL_LOG_NO_PREFIX = 'REV-';
/** Written by incoming-qc mirrorIncomingQcOntoNextQcOp, not by Op Entry. */
const INCOMING_QC_MIRROR_REMARK = 'Incoming QC (from the same inspection)';

function istNow(): { date: string; time: string } {
  const iso = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

/** What a later op has already done with the pieces this op passed on. */
function usedByOp(o: {
  opType: string;
  sent: number;
  ownComplete: number;
  ownProdRejected: number;
  completedQty: number;
  qcAccepted: number;
  qcRejected: number;
}): number {
  if (o.opType === 'qc') return o.qcAccepted + o.qcRejected;
  if (o.opType === 'outsource') return Math.max(o.sent, o.completedQty);
  return o.ownComplete + o.ownProdRejected + o.sent;
}

interface OpState {
  jcOpId: string;
  opSeq: number;
  opType: string;
  qcRequired: boolean;
  sent: number;
  inputAvail: number;
  completedQty: number;
  qcAccepted: number;
  qcRejected: number;
  ownComplete: number;
  ownProdRejected: number;
}

/** This op and the next one (by op_seq), read through v_jc_op_status — the
 *  same view every screen and every write guard reads. */
async function loadOpPair(
  tx: DbTransaction,
  jobCardId: string,
  opSeq: number,
): Promise<{ self: OpState | null; next: OpState | null }> {
  const rows = (await tx.execute(sql`
    SELECT
      o.id                                 AS "jcOpId",
      o.op_seq                             AS "opSeq",
      o.op_type::text                      AS "opType",
      o.qc_required                        AS "qcRequired",
      COALESCE(o.outsource_sent_qty, 0)    AS "sent",
      COALESCE(s.input_avail, 0)           AS "inputAvail",
      COALESCE(s.completed_qty, 0)         AS "completedQty",
      COALESCE(s.qc_accepted_qty, 0)       AS "qcAccepted",
      COALESCE(s.qc_rejected_qty, 0)       AS "qcRejected",
      COALESCE((SELECT SUM(l.qty) FROM public.op_log l
                 WHERE l.jc_op_id = o.id AND l.log_type = 'complete'), 0) AS "ownComplete",
      COALESCE((SELECT SUM(l.reject_qty) FROM public.op_log l
                 WHERE l.jc_op_id = o.id AND l.log_type = 'complete'), 0) AS "ownProdRejected"
    FROM public.jc_ops o
    LEFT JOIN public.v_jc_op_status s ON s.jc_op_id = o.id
    WHERE o.job_card_id = ${jobCardId}::uuid
      AND o.deleted_at IS NULL
      AND o.op_seq >= ${opSeq}
    ORDER BY o.op_seq
    LIMIT 2
  `)) as unknown as Array<Record<string, unknown>>;
  const toState = (r: Record<string, unknown> | undefined): OpState | null =>
    r
      ? {
          jcOpId: String(r['jcOpId']),
          opSeq: Number(r['opSeq']),
          opType: String(r['opType']),
          qcRequired: Boolean(r['qcRequired']),
          sent: Number(r['sent'] ?? 0),
          inputAvail: Number(r['inputAvail'] ?? 0),
          completedQty: Number(r['completedQty'] ?? 0),
          qcAccepted: Number(r['qcAccepted'] ?? 0),
          qcRejected: Number(r['qcRejected'] ?? 0),
          ownComplete: Number(r['ownComplete'] ?? 0),
          ownProdRejected: Number(r['ownProdRejected'] ?? 0),
        }
      : null;
  const self = toState(rows[0]);
  return {
    self: self && self.opSeq === opSeq ? self : null,
    next: toState(self && self.opSeq === opSeq ? rows[1] : rows[0]),
  };
}

export async function reverseOpLog(
  id: string,
  input: ReverseOpLogInput,
  user: AuthContext,
): Promise<OpLog> {
  // Undoing recorded production is a correction a supervisor signs: it needs
  // BOTH the edit and the approve right on Op Entry.
  await requireFormAccess(user, 'op_entry', 'edit');
  await requireFormAccess(user, 'op_entry', 'approve');
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  const companyId = user.companyId;
  const reason = input.reason.trim();

  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select({
        id: opLog.id,
        jcOpId: opLog.jcOpId,
        logNo: opLog.logNo,
        logType: opLog.logType,
        logDate: opLog.logDate,
        startTime: opLog.startTime,
        shift: opLog.shift,
        qty: opLog.qty,
        rejectQty: opLog.rejectQty,
        operatorId: opLog.operatorId,
        operatorName: opLog.operatorName,
        machineId: opLog.machineId,
        machineCodeText: opLog.machineCodeText,
        remarks: opLog.remarks,
        isTpi: opLog.isTpi,
        reversalOfId: opLog.reversalOfId,
      })
      .from(opLog)
      .where(and(eq(opLog.id, id), eq(opLog.companyId, companyId)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError('Op log entry not found. Refresh the page.');

    if (row.reversalOfId) {
      throw new ValidationError(`${row.logNo} is itself a reversal — it cannot be reversed.`);
    }
    if (row.logType === 'start') {
      throw new ValidationError('A Start entry records no qty — there is nothing to reverse.');
    }
    if (row.logNo.startsWith('LOG-NC-')) {
      throw new ValidationError(
        `${row.logNo} was put back by an NC decision — correct it on that NC, not here.`,
      );
    }
    if ((row.remarks ?? '').startsWith(INCOMING_QC_MIRROR_REMARK)) {
      throw new ValidationError(
        `${row.logNo} was written by Incoming QC on the GRN — correct it at Incoming QC.`,
      );
    }
    if (row.qty === 0 && row.rejectQty === 0) {
      throw new ValidationError(`${row.logNo} records no qty — there is nothing to reverse.`);
    }

    const opRows = await tx
      .select({
        jobCardId: jcOps.jobCardId,
        opSeq: jcOps.opSeq,
        operation: jcOps.operation,
        jcCode: jobCards.code,
        jcClosedAt: jobCards.closedAt,
      })
      .from(jcOps)
      .innerJoin(jobCards, eq(jobCards.id, jcOps.jobCardId))
      .where(and(eq(jcOps.id, row.jcOpId), eq(jcOps.companyId, companyId)))
      .limit(1);
    const op = opRows[0];
    if (!op) throw new NotFoundError('Operation not found. Refresh the page.');
    const opRef = jcOpRef(op.opSeq, op.operation);

    // Same row lock the production / QC writers take, on this op AND every
    // later one, so nobody logs against the next op while we check it.
    await tx.execute(sql`
      SELECT 1 FROM public.jc_ops
      WHERE job_card_id = ${op.jobCardId}::uuid AND op_seq >= ${op.opSeq}
      ORDER BY op_seq
      FOR UPDATE
    `);

    await assertProductionOrderNotShortClosed(tx, op.jobCardId);
    if (op.jcClosedAt) {
      throw new ValidationError(
        `Job Card ${op.jcCode} is closed — its entries cannot be reversed.`,
      );
    }
    const orderRows = (await tx.execute(sql`
      ${jobCardOrderChainCte(op.jobCardId)}
      SELECT po.code, po.status
      FROM chain
      JOIN public.production_orders po ON po.id = chain.production_order_id
      WHERE po.deleted_at IS NULL AND po.status <> 'open'
      ORDER BY chain.depth
      LIMIT 1
    `)) as unknown as Array<{ code: string; status: string }>;
    if (orderRows[0]) {
      const how = orderRows[0].status === 'partially_closed' ? 'partly closed' : 'closed';
      throw new ValidationError(
        `Production Order ${orderRows[0].code} is ${how} — reverse its close first, then this entry.`,
      );
    }
    const jcStatus = (await tx.execute(sql`
      SELECT computed_status FROM public.v_jc_status WHERE job_card_id = ${op.jobCardId}::uuid
    `)) as unknown as Array<{ computed_status: string | null }>;
    const st = jcStatus[0]?.computed_status ?? null;
    if (st === 'complete' || st === 'closed') {
      throw new ValidationError(
        `Job Card ${op.jcCode} is complete — its order line may already be closed. ` +
          'An entry on a completed Job Card cannot be reversed.',
      );
    }

    const already = await tx
      .select({ logNo: opLog.logNo })
      .from(opLog)
      .where(eq(opLog.reversalOfId, row.id))
      .limit(1);
    if (already[0]) {
      throw new ValidationError(`${row.logNo} was already reversed by ${already[0].logNo}.`);
    }

    const ncRows = (await tx.execute(sql`
      SELECT code FROM public.nc_register
      WHERE qc_log_id = ${row.id}::uuid AND deleted_at IS NULL
      ORDER BY code
    `)) as unknown as Array<{ code: string }>;
    if (ncRows.length > 0) {
      throw new ValidationError(
        `${row.logNo} raised ${ncRows.map((n) => n.code).join(', ')} — its deviated pieces are being handled ` +
          'on that NC, so the entry cannot be reversed.',
      );
    }

    if (row.logType === 'qc' && row.qty > 0) {
      const lastRows = (await tx.execute(sql`
        SELECT MAX(op_seq)::int AS last FROM public.jc_ops
        WHERE job_card_id = ${op.jobCardId}::uuid AND deleted_at IS NULL
      `)) as unknown as Array<{ last: number | null }>;
      if (lastRows[0]?.last === op.opSeq) {
        throw new ValidationError(
          `${row.logNo} is the last inspection on ${op.jcCode} — its accepted pieces have already ` +
            'gone on (to stock, or back to the original Job Card). It cannot be reversed here.',
        );
      }
    }

    const now = istNow();
    const inserted = await tx
      .insert(opLog)
      .values({
        companyId,
        jcOpId: row.jcOpId,
        logNo: `${REVERSAL_LOG_NO_PREFIX}${row.logNo}`,
        logType: row.logType,
        logDate: now.date,
        shift: row.shift,
        qty: -row.qty,
        rejectQty: -row.rejectQty,
        // The cancelled entry's operator and machine, so per-operator and
        // per-machine figures net on the same bucket.
        operatorId: row.operatorId,
        operatorName: row.operatorName,
        machineId: row.machineId,
        machineCodeText: row.machineCodeText,
        qcUserId: row.logType === 'qc' ? user.id : null,
        startTime: now.time,
        remarks: `Reversal of ${row.logNo}: ${reason}`,
        isTpi: row.isTpi,
        reversalOfId: row.id,
        reversalReason: reason,
        createdBy: user.id,
      })
      .returning({ id: opLog.id, logNo: opLog.logNo });
    const rev = inserted[0]!;

    // Recalculated state, read AFTER the insert through the same view.
    const { self, next } = await loadOpPair(tx, op.jobCardId, op.opSeq);
    if (self && row.logType === 'complete' && self.qcRequired) {
      const inspected = self.qcAccepted + self.qcRejected;
      if (inspected > self.completedQty) {
        throw new ValidationError(
          `QC on ${opRef} has already inspected ${inspected} piece(s); reversing ${row.logNo} ` +
            `would leave only ${self.completedQty} done. Reverse the QC entry first.`,
        );
      }
    }
    if (next) {
      const used = usedByOp(next);
      if (used > next.inputAvail) {
        throw new ValidationError(
          `The next operation (Op ${opSrNo(next.opSeq)}) has already used ${used} piece(s); reversing ` +
            `${row.logNo} would leave it only ${next.inputAvail}. Reverse the later entries first.`,
        );
      }
    }

    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Reverse,
        entity: 'JobCard',
        entityId: op.jobCardId,
        refId: op.jcCode,
        opRef,
        qty: -row.qty,
        operatorName: row.operatorName,
        reason,
        detail:
          `Reverses ${row.logNo} (${row.logType === 'qc' ? 'QC' : 'production'} entry of ` +
          `${logWhen(row.logDate, row.startTime)}): ${row.qty} ${row.logType === 'qc' ? 'accepted' : 'good'}, ` +
          `${row.rejectQty} deviated taken back — entry ${rev.logNo}`,
      },
      companyId,
      user,
    );

    const out = await selectOpLogById(tx, rev.id, companyId);
    if (!out) throw new NotFoundError('Reversal entry not found');
    return out;
  });
}
