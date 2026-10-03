// Incoming QC service (QC Wave 2) — read-only.
//
// GET /incoming-qc — inspection queue for received GRN lines awaiting QC, +
// pipeline metrics + recently-completed lines. Mirrors legacy renderIncomingQC
// (HTML L23748). Raw SQL over goods_receipt_note_lines ⨝ headers ⨝ vendors ⨝
// items. RLS via base tables. The Inspect action lives on the GRN detail page
// (existing goods-receipt-notes update flow), so there is no write here.

import { and, eq, isNull, sql } from 'drizzle-orm';
import type { SubmitIncomingQcInput } from '@innovic/shared';
import { ActivityAction, isTpiOp } from '@innovic/shared';
import {
  goodsReceiptNoteLines,
  goodsReceiptNotes,
  jcOps,
  jobCards,
  opLog,
  purchaseOrderLines,
} from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { requireWriteRole } from '../../lib/auth';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { assertProductionOrderNotShortClosed } from '../../lib/production-order-stop';
import { assertQtyFitsUom, roundQty } from '../../lib/stock-ledger';
import { emitActivityLog } from '../activity-log/service';
import { isOspOpFullyBack } from '../delivery-challans/receipt-cascades';
import {
  creditGrnQcStock,
  isJwDcReceiptGrn,
  recalcPoHeaderStatus,
  recalcPoLineReceivedQty,
  resolveGrnLineJobCardId,
} from '../goods-receipt-notes/cascades';
import {
  autoCreateMaterialNcFromIqcReject,
  autoCreateNcFromQcReject,
} from '../nc-register/cascades';
import { onNcReplacementQc, onRecoveryJobCardQc } from '../nc-register/recovery';
import { recoveryChildCreditsStock, tryApplyQcStockCascade } from '../op-entry/qc-stock-cascade';
import { tryCascadeJcComplete } from '../op-entry/sales-cascade';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

/** Today's date in IST (fixed UTC+5:30, no DST) — the shop's calendar day,
 *  matching op-entry's own `istToday`. A UTC slice would date a late-evening
 *  inspection on yesterday. */
function istToday(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Same marker op-entry's nextLogNo() writes: not unique by spec (ADR-011 #4),
 *  the uuid PK is the addressable id. Copied rather than imported so this
 *  module does not pull the whole op-entry service in for one string. */
function nextLogNo(): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:T.Z]/g, '')
    .slice(0, 14);
  return `LOG-${stamp}`;
}

/**
 * Step-6 completion for OSP: push the newly QC-accepted qty back onto the
 * outsource jc_op this GRN line came from (via its PO line's source_jc_op_id),
 * so the operation records how much genuinely returned. `outsource_returned_qty`
 * is what customer-dispatch readiness reads, so this is what makes a partial
 * outsource return dispatchable. No-op unless the op is an outsource op and a
 * positive qty was accepted. Runs in the caller's tx.
 */
async function creditOutsourceReturn(
  tx: DbTransaction,
  companyId: string,
  jcOpId: string | null,
  acceptedDelta: number,
  userId: string,
): Promise<void> {
  if (!jcOpId || acceptedDelta <= 0) return;
  const opRows = await tx
    .select({
      id: jcOps.id,
      opType: jcOps.opType,
      sentQty: jcOps.outsourceSentQty,
      returnedQty: jcOps.outsourceReturnedQty,
    })
    .from(jcOps)
    .where(and(eq(jcOps.id, jcOpId), isNull(jcOps.deletedAt)))
    .limit(1)
    // S6 — lock the op: two GRN lines of the same op inspected at once
    // serialize here, and the second reads the first one's returned qty.
    .for('update');
  const op = opRows[0];
  // Dual-lane (ADR-081): also credit the return onto a PROCESS op that carries an
  // OSP balance (it has a sent qty), not only whole op_type='outsource' ops.
  if (!op) return;
  if (op.opType !== 'outsource' && (op.sentQty ?? 0) <= 0) return;
  const newReturned = (op.returnedQty ?? 0) + acceptedDelta;
  // The 'received' flip needs BOTH: the QC-accepted total covers the sent qty
  // AND the shared "every piece is back in the building" predicate agrees
  // (ordinary receipts cover outsource_sent_qty, no return-to-vendor piece
  // still out on ANY NC of this op). Without the second half, two open RTV
  // NCs on one op could read 'received' here while receipt-cascades /
  // nc-register still had pieces at the vendor — two writers disagreeing on
  // one column. The returned-qty increment itself is unconditional.
  const returnedCoversSent = op.sentQty > 0 && newReturned >= op.sentQty;
  const fullyReturned =
    returnedCoversSent && (await isOspOpFullyBack(tx, companyId, op.id, op.sentQty)).fullyBack;
  await tx
    .update(jcOps)
    .set({
      // S6 — one-statement counter; migration 0181's CHECK keeps it ≤ sent.
      outsourceReturnedQty: sql`${jcOps.outsourceReturnedQty} + ${acceptedDelta}`,
      // Flip to 'received' once the whole sent qty is back; partials keep their
      // current status (still 'sent'/'at_vendor') but now carry a return count.
      ...(fullyReturned ? { outsourceStatus: 'received' as const } : {}),
      updatedBy: userId,
    })
    .where(eq(jcOps.id, op.id));
}

/**
 * §7 OSP QC de-duplication (docs/QC-NC-HANDLING-DESIGN.md §6).
 *
 * The procedure forbids inspecting the same pieces twice: when an outsourced
 * op is followed by a QC op on the route, the vendor's returned pieces get ONE
 * inspection — Incoming QC — and that inspection IS the route's QC. Before
 * this, the QC op still showed the whole returned qty as "QC pending" and the
 * inspector had to key the identical accept/reject a second time, raising a
 * second NC for the same rejects.
 *
 * So after the GRN line result is written, mirror THIS submission's delta
 * (accepted, rejected — never the line's running totals, because a line can be
 * inspected in several sittings) as one qc op_log row on the very next op of
 * the same job card when that op is a QC op. Written directly, not through
 * submitQcLog: that path would raise a second NC for the reject, and the NC
 * for these pieces was already raised by the Incoming QC reject above. The QC
 * op then reads qc_pending = 0 for those pieces and the accepted ones flow on.
 *
 * Only op_seq + 1 qualifies, and only op_type = 'qc'. A QC op two steps down
 * inspects something else (another process has happened in between), and a
 * process op next in line needs no mirror — the outsource op's own output
 * already feeds it. No-op when the source op is not an outsource op.
 *
 * Runs for a return-to-vendor REPLACEMENT too (`replacementNcId` set). The
 * vendor's replacement pieces are inspected once, here, exactly like the
 * first-cycle pieces, and they must reach op_seq + 1 the same way: the NC
 * settlement (onNcReplacementQc) only recomputes the PO for a PO-linked
 * origin and writes NO op_log row, so without this mirror the accepted
 * replacements never reached the QC op and the job card sat at qc_pending
 * with those pieces "pending" forever (OSP chain gap G1, 2026-09-16). The
 * in-house re-inject branch of onNcReplacementQc cannot fire for the same
 * line — an in-house-origin NC can never have a return-to-vendor challan
 * (nc-register/cascades.ts, return_to_vendor requires a vendor source).
 */
async function mirrorIncomingQcOntoNextQcOp(
  tx: DbTransaction,
  companyId: string,
  sourceJcOpId: string | null,
  acceptedDelta: number,
  rejectedDelta: number,
  replacementNcId: string | null,
  user: AuthContext,
): Promise<void> {
  // Only the ACCEPTED pieces are mirrored. The following QC op's input is the
  // outsource op's output, which is the GRN-accepted qty alone -- a piece
  // rejected at Incoming QC never reaches the next op, so writing its reject
  // there too would make that op's inspected qty exceed its input and count
  // the same reject twice (once on the outsource op via the GRN line, once
  // here). The reject is already fully recorded: on the GRN line, and as the
  // NC raised against the outsource op.
  if (!sourceJcOpId || acceptedDelta <= 0) return;
  const srcRows = await tx
    .select({
      jobCardId: jcOps.jobCardId,
      opSeq: jcOps.opSeq,
      opType: jcOps.opType,
      jcCode: jobCards.code,
    })
    .from(jcOps)
    .innerJoin(jobCards, eq(jobCards.id, jcOps.jobCardId))
    .where(and(eq(jcOps.id, sourceJcOpId), eq(jcOps.companyId, companyId), isNull(jcOps.deletedAt)))
    .limit(1);
  const src = srcRows[0];
  if (!src || src.opType !== 'outsource') return;
  const nextRows = await tx
    .select({ id: jcOps.id, opType: jcOps.opType, operation: jcOps.operation })
    .from(jcOps)
    .where(
      and(
        eq(jcOps.jobCardId, src.jobCardId),
        eq(jcOps.opSeq, src.opSeq + 1),
        eq(jcOps.companyId, companyId),
        isNull(jcOps.deletedAt),
      ),
    )
    .limit(1);
  const next = nextRows[0];
  if (!next || next.opType !== 'qc') return;
  // A TPI op is NOT satisfied by our own Incoming QC (ADR-179 allows TPI
  // directly after OSP). The third party must inspect the pieces: leave the
  // TPI op at qc_pending so it shows on the TPI tab of the QC Call Register
  // and is accepted only through the TPI submit (op-entry submitQcLog with
  // isTpi), which also runs the last-op stock cascade.
  if (isTpiOp(next)) return;
  const logDate = istToday();
  const inserted = await tx
    .insert(opLog)
    .values({
      companyId,
      jcOpId: next.id,
      logNo: nextLogNo(),
      logType: 'qc',
      logDate,
      shift: 'day',
      qty: acceptedDelta,
      rejectQty: 0,
      operatorId: null,
      operatorName: user.fullName ?? user.email,
      // No machine on QC: inspection is not machining (op-entry, ISSUE-010).
      machineId: null,
      remarks: 'Incoming QC (from the same inspection)',
      createdBy: user.id,
    })
    .returning({ id: opLog.id });

  // Recovery settlement (design §4): this mirrored qc row is written straight to
  // op_log, NOT through op-entry submitQcLog, so it used to skip the recovery
  // hook. When `next` is the TERMINAL op of a rework/repair CHILD job card, that
  // meant the child's parent NC was never credited/closed and the parent op sat
  // `under_rework` forever (and, with 0124, could not complete) even though the
  // pieces had been recovered. Route the mirrored accepted pieces through the
  // same hook op-entry uses. It is a no-op for an ordinary JC or a non-terminal
  // op, so this only fires for a recovery child whose last op is fed by an
  // outsource op's incoming QC.
  //
  // Skipped for a return-to-vendor replacement: onNcReplacementQc (called
  // right after this mirror) already climbs the accepted replacement pieces up
  // the parent chain for a recovery child, so running the hook here as well
  // would credit the ancestor NCs twice for the same pieces.
  const mirroredId = inserted[0]?.id;
  if (mirroredId && !replacementNcId) {
    await onRecoveryJobCardQc(
      tx,
      {
        jobCardId: src.jobCardId,
        jcOpId: next.id,
        acceptedQty: acceptedDelta,
        rejectedQty: 0,
        qcLogId: mirroredId,
        logDate,
        shift: 'day',
      },
      companyId,
      user,
    );
  }

  // Stock credit when the mirrored QC op is the job card's LAST op (OSP chain
  // gap G3, 2026-09-16). creditGrnQcStock deliberately skips a mid-route OSP
  // line (ADR-092: the JC's final QC op credits the store, not the GRN) — but
  // the row above is a raw op_log insert, not op-entry's submitQcLog, so the
  // last-op cascade that normally runs there never ran and the pieces reached
  // the store on paper nowhere. Same cascade, same tx. It is a no-op unless
  // op_seq + 1 is the highest op on the JC, so a QC op that is NOT last credits
  // nothing (a later op's QC does). No double credit either way: the GRN's own
  // grn_qc row was skipped because the line is mid-route, and this one writes
  // source_type 'qc_accept' against the JC op, exactly as a keyed QC log would.
  //
  // Recovery-child guard (ADR-069), the SAME one op-entry/service.submitQcLog
  // applies before its own tryApplyQcStockCascade: on a rework/repair CHILD
  // job card the accepted pieces are re-injected into the PARENT route by
  // onRecoveryJobCardQc (just above) and the parent's terminal QC credits them
  // later, so crediting here too would book every recovered piece twice. The
  // child credits only when the origin op IS the parent's terminal op. One
  // implementation (recoveryChildCreditsStock) serves both writers so they
  // stay in lock-step.
  if (mirroredId && (await recoveryChildCreditsStock(tx, companyId, src.jobCardId))) {
    await tryApplyQcStockCascade(
      tx,
      {
        companyId,
        jobCardId: src.jobCardId,
        jcCode: src.jcCode,
        opSeq: src.opSeq + 1,
        acceptedQty: acceptedDelta,
        txnDate: logDate,
      },
      user,
    );
  }
}

// The read (GET /incoming-qc) lives in ./read.ts (ADR-201 paging).
export { getIncomingQc } from './read';

/**
 * Record incoming QC for ONE GRN line (the Incoming QC Call Register inline
 * accept/reject) — INCREMENTALLY. Each call adds this inspection's accept/reject
 * onto the line's running totals, credits ONLY the newly-accepted qty to stock
 * (grn_qc), stamps the inspector, and marks the line 'completed' only once it is
 * fully accounted for (accepted + rejected = received). A partial inspection
 * leaves the line 'in_progress' with the remaining qty, so it stays in the
 * pending queue to be finished later. Narrowed to a single line so it can't
 * disturb the rest of the GRN.
 */
export async function submitIncomingQc(
  grnLineId: string,
  input: SubmitIncomingQcInput,
  user: AuthContext,
): Promise<{ ok: true; grnId: string; raisedNc: { id: string; code: string } | null }> {
  requireWriteRole(user);
  // ADR-035: enforce the per-department QC tier, not just the role — a user
  // with Incoming QC view-only (L1) must not accept/reject received goods even
  // if their global role is manager. Admins bypass.
  await requireFormAccess(user, 'qc_incoming', 'entry');
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select({
        id: goodsReceiptNoteLines.id,
        grnId: goodsReceiptNoteLines.goodsReceiptNoteId,
        grnCode: goodsReceiptNotes.code,
        lineNo: goodsReceiptNoteLines.lineNo,
        itemId: goodsReceiptNoteLines.itemId,
        receivedQty: goodsReceiptNoteLines.receivedQty,
        acceptedQty: goodsReceiptNoteLines.qcAcceptedQty,
        rejectedQty: goodsReceiptNoteLines.qcRejectedQty,
        poLineId: goodsReceiptNoteLines.purchaseOrderLineId,
        // Set when this GRN is the vendor's REPLACEMENT for a return-to-vendor
        // NC (design §5): the inspection then settles that NC, not a fresh one.
        ncId: goodsReceiptNotes.ncId,
      })
      .from(goodsReceiptNoteLines)
      .innerJoin(
        goodsReceiptNotes,
        eq(goodsReceiptNotes.id, goodsReceiptNoteLines.goodsReceiptNoteId),
      )
      .where(
        and(
          eq(goodsReceiptNoteLines.id, grnLineId),
          eq(goodsReceiptNoteLines.companyId, companyId),
          isNull(goodsReceiptNoteLines.deletedAt),
        ),
      )
      .limit(1)
      // ADR-189 — lock the line: two inspectors submitting at once must not both
      // read the same QC Pending and each credit stock for it. The second waits
      // here and re-reads the first one's figures.
      .for('update');
    const line = rows[0];
    if (!line) throw new NotFoundError('GRN line not found. Refresh the page.');

    // ADR-182 — an OSP return belonging to a short-closed Production Order's
    // Job Card cannot be inspected. A plain purchase GRN resolves to no jc_op
    // and is never touched by this.
    // A JW DC receipt (0172) is a store loop, not Job Card work: it credits
    // stock on accept and never runs the OSP op cascade (isJwDcReceiptGrn).
    const jwDcReceipt = await isJwDcReceiptGrn(tx, line.grnId);
    const guardJcId = jwDcReceipt ? null : await resolveGrnLineJobCardId(tx, grnLineId);
    if (guardJcId) await assertProductionOrderNotShortClosed(tx, guardJcId);

    // Decimal on KGS / MTR receipts (0172) — every figure rounded to the
    // ledger's 3 places so 0.1 + 0.2 float drift cannot fake an over-inspection.
    const priorAccepted = line.acceptedQty ?? 0;
    const priorRejected = line.rejectedQty ?? 0;
    const remaining = roundQty(line.receivedQty - priorAccepted - priorRejected);
    if (remaining <= 0) {
      throw new ConflictError(
        'QC is already Completed for this GRN line. It can no longer be changed.',
      );
    }
    const thisTotal = roundQty(input.acceptedQty + input.rejectedQty);
    if (thisTotal > remaining) {
      throw new ValidationError(
        `Accepted + Deviated (${thisTotal}) cannot be more than QC Pending (${remaining}).`,
      );
    }
    // A fraction is only right for a KGS / MTR item. Job Card pieces coming back
    // from an OSP vendor, and NOS / SET items, are counted whole.
    if (!Number.isInteger(input.acceptedQty) || !Number.isInteger(input.rejectedQty)) {
      const kind = (await tx.execute(sql`
        SELECT COALESCE(i.code, l.item_code_text, 'Item') AS code,
               COALESCE(i.uom::text, 'NOS') AS uom,
               (pol.source_jc_op_id IS NOT NULL) AS is_osp
        FROM public.goods_receipt_note_lines l
        LEFT JOIN public.items i ON i.id = l.item_id
        LEFT JOIN public.purchase_order_lines pol ON pol.id = l.purchase_order_line_id
        WHERE l.id = ${grnLineId}::uuid
      `)) as unknown as Array<{ code: string; uom: string; is_osp: boolean }>;
      const k = kind[0];
      if (k?.is_osp) {
        throw new ValidationError(
          `${k.code}: Accepted and Deviated must be whole pieces — this is Job Card work back from the vendor.`,
        );
      }
      if (k) {
        if (input.acceptedQty > 0) assertQtyFitsUom(k.code, k.uom, input.acceptedQty, 'Accepted');
        if (input.rejectedQty > 0) assertQtyFitsUom(k.code, k.uom, input.rejectedQty, 'Deviated');
      }
    }

    const newAccepted = roundQty(priorAccepted + input.acceptedQty);
    const newRejected = roundQty(priorRejected + input.rejectedQty);
    const fullyDone = roundQty(line.receivedQty - newAccepted - newRejected) <= 0;
    // One inspection date for the line stamp, the NC and the replacement
    // cascade, so the three can never disagree about when this happened.
    const qcDate = input.qcDate ?? istToday();

    await tx
      .update(goodsReceiptNoteLines)
      .set({
        qcStatus: fullyDone ? 'completed' : 'in_progress',
        qcAcceptedQty: newAccepted,
        qcRejectedQty: newRejected,
        qcDate,
        // WHO INSPECTED vs WHO TYPED IT IN — routinely two different people.
        // `qc_inspected_by` is the inspector picked from the QC user list; it
        // falls back to the submitter only when no user was picked (import, or
        // an inspector with no login). The submitter stays traceable through
        // `updated_by` below. The text stays a snapshot of the name signed off
        // on the day, so it does not change if that person is later renamed.
        qcInspectedBy: input.qcInspectedByUserId ?? user.id,
        qcInspectedByText: input.qcInspectedByName,
        // Keep prior remarks/report when this inspection doesn't supply new ones.
        ...(input.qcRemarks !== undefined ? { qcRemarks: input.qcRemarks } : {}),
        ...(input.qcReportPath !== undefined
          ? { qcReportPath: input.qcReportPath, qcReportName: input.qcReportName ?? null }
          : {}),
        updatedBy: user.id,
      })
      .where(eq(goodsReceiptNoteLines.id, grnLineId));

    // Credit ONLY this inspection's accepted delta to stock (one ledger row per
    // partial accept), independent of whether the line is now fully done.
    await creditGrnQcStock({
      tx,
      companyId,
      adminUserId: user.id,
      grnId: line.grnId,
      grnLineId: line.id,
      itemId: line.itemId,
      qty: input.acceptedQty,
    });
    if (line.poLineId) {
      await recalcPoLineReceivedQty(tx, line.poLineId, user.id);
      const poRows = await tx
        .select({
          poId: purchaseOrderLines.purchaseOrderId,
          sourceJcOpId: purchaseOrderLines.sourceJcOpId,
        })
        .from(purchaseOrderLines)
        .where(eq(purchaseOrderLines.id, line.poLineId))
        .limit(1);
      if (poRows[0]) {
        await recalcPoHeaderStatus(tx, poRows[0].poId, user.id);
      }
      // No Job Card op behind a JW DC receipt: skip the outsource-op cascade.
      if (poRows[0] && !jwDcReceipt) {
        // Step 6: record the accepted qty on the source outsource op so partial
        // returns become visible to the JC (and dispatchable — see Change 2).
        //
        // Also run for a return-to-vendor REPLACEMENT (line.ncId set). It is
        // not a double credit: outsource_returned_qty only ever counted pieces
        // ACCEPTED at Incoming QC, so the pieces this NC covers were rejected
        // and never credited — the vendor still owed them against the op's
        // sent qty. The replacement's accepted pieces are that debt being
        // paid, and without this credit `returned` could never reach `sent`
        // and the op would sit at 'sent' with the material in the building.
        await creditOutsourceReturn(
          tx,
          companyId,
          poRows[0].sourceJcOpId,
          input.acceptedQty,
          user.id,
        );
        // Also for a replacement (line.ncId set) — see the mirror's docstring:
        // the NC settlement below writes no op_log row for a PO-linked origin,
        // so this is the only path that carries accepted replacement pieces
        // on to the following QC op.
        await mirrorIncomingQcOntoNextQcOp(
          tx,
          companyId,
          poRows[0].sourceJcOpId,
          input.acceptedQty,
          input.rejectedQty,
          line.ncId ?? null,
          user,
        );
      }
    }

    // Return-to-vendor replacement (design §5): this inspection settles the
    // NC that sent the pieces back — cleared/failed on the NC, close when the
    // gate is met, and the PO line is recomputed to count the cleared pieces.
    // It writes NO op_log row for a PO-linked (vendor) origin: the GRN line
    // already rolls into the outsource op through v_jc_op_status, and the §7
    // mirror above is what carries the accepted pieces on to the next QC op.
    // (The cascade's in-house re-inject branch only fires for an NC with no
    // outsource PO line, which can never have a return-to-vendor challan.)
    // Rejected pieces raise their follow-on NC below through the same auto-NC
    // path as any other Incoming QC reject.
    if (line.ncId) {
      await onNcReplacementQc(
        tx,
        {
          ncId: line.ncId,
          acceptedQty: input.acceptedQty,
          rejectedQty: input.rejectedQty,
          grnLineId: line.id,
          logDate: qcDate,
        },
        companyId,
        user,
      );
    }

    // A reject at Incoming QC raises a defect record (NC), mirroring production
    // QC (op-entry submitQcLog, T-040e). This is the SINGLE place vendor-return
    // rejects are captured now that the receive step no longer takes a reject
    // qty — so the reject decision and its NC both live at QC.
    //
    // Phase 1 covers JOB-WORK returns only: the GRN line must trace back through
    // its PO line to a jc_op with a job card. Raw-material rejects (no source
    // jc_op / no job card) currently raise no NC — a job-card-less NC needs a
    // schema change (planned as a separate phase).
    // The NC a reject raised goes back to the popup, so it can say "NC … raised
    // — Dispose now →" like process QC does (incoming-qc-inspect#1).
    let raisedNc: { id: string; code: string } | null = null;
    if (input.rejectedQty > 0 && line.poLineId) {
      // A JW DC receipt's reject is a material reject (no op) — it falls
      // through to the job-card-less NC below.
      const jcOpRows = jwDcReceipt
        ? []
        : await tx
            .select({
              jcOpId: jcOps.id,
              jobCardId: jcOps.jobCardId,
              opSeq: jcOps.opSeq,
              operation: jcOps.operation,
              jcCode: jobCards.code,
            })
            .from(purchaseOrderLines)
            .innerJoin(
              jcOps,
              and(eq(jcOps.id, purchaseOrderLines.sourceJcOpId), isNull(jcOps.deletedAt)),
            )
            .innerJoin(jobCards, and(eq(jobCards.id, jcOps.jobCardId), isNull(jobCards.deletedAt)))
            .where(eq(purchaseOrderLines.id, line.poLineId))
            .limit(1);
      const src = jcOpRows[0];
      if (src) {
        const nc = await autoCreateNcFromQcReject(
          tx,
          {
            companyId,
            jobCardId: src.jobCardId,
            jcOpId: src.jcOpId,
            jcCode: src.jcCode,
            opSeq: src.opSeq,
            operationText: src.operation,
            rejectedQty: input.rejectedQty,
            ncDate: qcDate,
            reportedByText: input.qcInspectedByName ?? null,
            remarks: input.qcRemarks ?? null,
            // The GRN line this reject was found on (design §3,
            // nc_register.grn_line_id) — the receipt end of the trail.
            grnLineId: line.id,
            // WI1: no machine here. This is Incoming QC of VENDOR material (the
            // source op is outsourced), so the pieces were made by the vendor,
            // not on an in-house machine — machineCodeText stays null.
            machineCodeText: null,
          },
          user,
        );
        raisedNc = { id: nc.ncId, code: nc.ncCode };
      } else {
        // ADR-189 — a bought-material reject (no job card behind the PO line):
        // raise an NC with no job card so the rejected pieces are on record
        // until they are scrapped or returned to the vendor.
        raisedNc = await autoCreateMaterialNcFromIqcReject(
          tx,
          {
            companyId,
            grnLineId: line.id,
            grnCode: line.grnCode,
            lineNo: line.lineNo,
            rejectedQty: input.rejectedQty,
            ncDate: qcDate,
            reportedByText: input.qcInspectedByName ?? null,
            remarks: input.qcRemarks ?? null,
          },
          user,
        );
      }
    }

    await emitActivityLog(
      tx,
      // ADR-197 — an inspection is its own QC action on the GRN (never a
      // generic EDIT): the line, the accepted qty and the inspector named on
      // the entry (who may not be the user pressing Submit).
      {
        action: ActivityAction.QC,
        entity: 'GoodsReceiptNote',
        entityId: line.grnId,
        refId: line.grnCode,
        lineRef: `Line ${line.lineNo}`,
        qty: input.acceptedQty,
        operatorName: input.qcInspectedByName,
        detail: `${line.grnCode} Line ${line.lineNo} — Incoming QC: ${input.acceptedQty} accepted, ${input.rejectedQty} deviated`,
      },
      companyId,
      user,
    );

    // Job-card completion (OSP chain gap G2, 2026-09-16). When the outsource
    // op is the JC's LAST op, this accept is what takes it to 'complete' — the
    // receive step ran tryCascadeJcComplete while the pieces were still
    // pending QC, so nothing ever set job_cards.closed_at or closed the SO/JW
    // line. Same idempotent cascade op-entry runs after a QC log: it fires
    // only when v_jc_status reads complete/closed, and never re-flips a line
    // that is already terminal. Runs after the auto-NC block so the status
    // view sees this inspection's reject too. Not for a JW DC receipt (no op).
    if (line.poLineId && !jwDcReceipt) {
      const srcOpRows = await tx
        .select({ jobCardId: jcOps.jobCardId })
        .from(purchaseOrderLines)
        .innerJoin(
          jcOps,
          and(eq(jcOps.id, purchaseOrderLines.sourceJcOpId), isNull(jcOps.deletedAt)),
        )
        .where(eq(purchaseOrderLines.id, line.poLineId))
        .limit(1);
      const srcJobCardId = srcOpRows[0]?.jobCardId;
      if (srcJobCardId) {
        await tryCascadeJcComplete(tx, srcJobCardId, user);
      }
    }

    // ADR-190 Addendum — no task auto-close here. A task linked to a GRN is
    // raised by hand ("Inspect …" from the list, "Follow up on GRN …" from the
    // detail) with the same link and an editable title, so nothing tells an
    // inspection task from a follow-up; inspecting must not close a chase.

    return { ok: true as const, grnId: line.grnId, raisedNc };
  });
}
