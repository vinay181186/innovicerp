// Delivery-challan outward cascades (T-059a).
//
// Two transactional helpers fired alongside a DC create / cancel. Both accept
// the caller's open `tx` so cascade effects roll back if the DC write itself
// fails (no nested transactions).
//
//   1. applyOutwardToJcOp(tx, args)
//        For a DC line linked to a JW PO line, find the corresponding outsource
//        jc_op (via jc_ops.outsource_po_line_id) and bump:
//          - outsource_sent_qty += qty
//          - outsource_sent_date = dcDate (set when null OR replace with earlier)
//          - outsource_dc_no = dcCode (overwrites; legacy only stored the latest)
//          - outsource_status: pending/pr_raised/po_created → 'sent' (permissive)
//        Idempotent w.r.t. status (already 'sent'/'received' → leave alone).
//        Returns the jc_op snapshot for audit emission. No-op when no jc_op
//        is linked to the PO line (free-standing PO without outsource ops).
//
//   2. reverseOutwardFromJcOp(tx, args)
//        Cancel path. Inverse of #1:
//          - outsource_sent_qty -= qty (clamped at 0)
//          - if outsource_sent_qty hits 0 AND status='sent', downgrade to
//            'po_created' (back to pre-issue state)
//          - if outsource_dc_no matches dcCode being cancelled, clear it
//        Idempotent — already-zero / already-downgraded rows pass through.
//
// Stock-ledger movement on DC issue/cancel was REMOVED in ADR-067 (Option A):
// OSP send is now stock-neutral. Sending material out for processing no longer
// debits finished stock (source_type='jw_out'); the qty out is tracked as
// "at vendor" via v_osp_wip, and production is credited only on QC-accept of
// the return. This eliminated the send(−)/receive(+) pair that netted to zero
// and let a later dispatch drive on-hand negative (SO-517 trace).

import { and, eq, isNull, sql } from 'drizzle-orm';
import { jcOps, jobCards } from '../../db/schema';
import type { DbTransaction } from '../../db/with-user-context';
import { ValidationError } from '../../lib/errors';
import { loadMaterialCap } from '../op-entry/service';

export interface OutwardCascadeArgs {
  tx: DbTransaction;
  companyId: string;
  adminUserId: string;
  dcCode: string;
  dcDate: string; // YYYY-MM-DD
  purchaseOrderLineId: string;
  qty: number; // integer pcs sent on this DC line
}

export interface OutwardCascadeResult {
  /** True when a matching jc_op was found and bumped. */
  fired: boolean;
  jcOpId?: string;
  jcCode?: string;
  opSeq?: number;
  prevStatus?: string | null;
  nextStatus?: string;
  newSentQty?: number;
}

const PRE_SENT_STATUSES = new Set(['pending', 'pr_raised', 'po_created']);

export async function applyOutwardToJcOp(args: OutwardCascadeArgs): Promise<OutwardCascadeResult> {
  const { tx, companyId, adminUserId, dcCode, dcDate, purchaseOrderLineId, qty } = args;

  const rows = await tx
    .select({
      id: jcOps.id,
      opSeq: jcOps.opSeq,
      jobCardId: jcOps.jobCardId,
      outsourceStatus: jcOps.outsourceStatus,
      outsourceSentQty: jcOps.outsourceSentQty,
      outsourceSentDate: jcOps.outsourceSentDate,
      outsourceDcNo: jcOps.outsourceDcNo,
    })
    .from(jcOps)
    .where(
      and(
        eq(jcOps.outsourcePoLineId, purchaseOrderLineId),
        eq(jcOps.companyId, companyId),
        // Dual-lane (ADR-081): match by the OSP PO line regardless of op_type, so
        // a PROCESS op carrying an OSP balance also gets its sent-qty tracked
        // (not only whole op_type='outsource' ops).
        isNull(jcOps.deletedAt),
      ),
    )
    .limit(1);
  const op = rows[0];
  if (!op) return { fired: false };

  // Availability guard (ADR-078): you cannot outsource more than the previous
  // stage has actually cleared into this op. The in-house progress paths already
  // enforce this (submitOpLog / submitQcLog reject qty > available), but the
  // OSP-send path did not — letting the full qty be issued to a vendor with zero
  // upstream progress (SO-537 / IN-JC-26-00034: S2 sent 10 with input_avail 0).
  // Cap = the op's upstream input (v_jc_op_status.input_avail) minus what has
  // already been sent. input_avail is the previous op's cleared output (or the
  // JC order qty for op_seq 1), so a first/whole-op outsource still sends freely.
  const availRows = (await tx.execute(
    sql`SELECT input_avail FROM public.v_jc_op_status WHERE jc_op_id = ${op.id}`,
  )) as unknown as Array<{ input_avail: number | string }>;
  const inputAvail = Number(availRows[0]?.input_avail ?? 0);
  // Dual-lane (ADR-081): also subtract what has already been finished IN-HOUSE on
  // this op, so you can only outsource the genuine un-done balance. For a whole
  // outsource op there are no in-house completions, so this is 0 (unchanged
  // ADR-078 behaviour: sendable = input − sent).
  const doneRows = (await tx.execute(
    sql`SELECT COALESCE(SUM(qty), 0) AS c FROM public.op_log WHERE jc_op_id = ${op.id} AND log_type = 'complete'`,
  )) as unknown as Array<{ c: number | string }>;
  const inHouseCompleted = Number(doneRows[0]?.c ?? 0);
  const sendable = inputAvail - inHouseCompleted - op.outsourceSentQty;

  // Client-material gate: when this is the FIRST op of a JWSO Job Card, the
  // client's material must have arrived (Party Material GRN) before it can be
  // sent to the vendor. Cap the sendable qty at material received for the part;
  // the limit lifts automatically as more material is received. No-op for
  // SO-sourced JCs and for non-first ops (already bounded by upstream output).
  const cap = await loadMaterialCap(tx, op, companyId);
  const effectiveSendable = cap ? Math.max(0, sendable - cap.shortfall) : sendable;
  if (qty > effectiveSendable) {
    if (cap && effectiveSendable < sendable) {
      throw new ValidationError(
        `Cannot send ${qty} pcs to the vendor — only ${effectiveSendable} has client material ` +
          `(received ${cap.received} of ${cap.orderQty} for this part, JWSO ${cap.jwCode}). ` +
          `Record a Party Material GRN before sending the balance out.`,
      );
    }
    throw new ValidationError(
      `Cannot outsource ${qty} pcs — only ${Math.max(0, sendable)} available on this operation ` +
        `(upstream cleared ${inputAvail}, done in-house ${inHouseCompleted}, already sent ${op.outsourceSentQty}). ` +
        `Complete or free up the quantity before sending it to the vendor.`,
    );
  }

  const jcRows = await tx
    .select({ code: jobCards.code })
    .from(jobCards)
    .where(eq(jobCards.id, op.jobCardId))
    .limit(1);
  const jcCode = jcRows[0]?.code ?? '';

  const prevStatus = op.outsourceStatus ?? null;
  const nextStatus =
    prevStatus && PRE_SENT_STATUSES.has(prevStatus) ? 'sent' : (prevStatus ?? 'sent');
  const newSentQty = op.outsourceSentQty + qty;

  // sentDate keeps the earliest issue date if a prior DC was issued first.
  const nextSentDate =
    !op.outsourceSentDate || dcDate < op.outsourceSentDate ? dcDate : op.outsourceSentDate;

  await tx
    .update(jcOps)
    .set({
      outsourceSentQty: newSentQty,
      outsourceSentDate: nextSentDate,
      outsourceDcNo: dcCode,
      outsourceStatus: nextStatus as typeof op.outsourceStatus,
      updatedBy: adminUserId,
    })
    .where(eq(jcOps.id, op.id));

  return {
    fired: true,
    jcOpId: op.id,
    jcCode,
    opSeq: op.opSeq,
    prevStatus,
    nextStatus,
    newSentQty,
  };
}

export async function reverseOutwardFromJcOp(
  args: OutwardCascadeArgs,
): Promise<OutwardCascadeResult> {
  const { tx, companyId, adminUserId, dcCode, purchaseOrderLineId, qty } = args;

  const rows = await tx
    .select({
      id: jcOps.id,
      opSeq: jcOps.opSeq,
      jobCardId: jcOps.jobCardId,
      outsourceStatus: jcOps.outsourceStatus,
      outsourceSentQty: jcOps.outsourceSentQty,
      outsourceDcNo: jcOps.outsourceDcNo,
    })
    .from(jcOps)
    .where(
      and(
        eq(jcOps.outsourcePoLineId, purchaseOrderLineId),
        eq(jcOps.companyId, companyId),
        // Dual-lane (ADR-081): match by the OSP PO line regardless of op_type, so
        // a PROCESS op carrying an OSP balance also gets its sent-qty tracked
        // (not only whole op_type='outsource' ops).
        isNull(jcOps.deletedAt),
      ),
    )
    .limit(1);
  const op = rows[0];
  if (!op) return { fired: false };

  const jcRows = await tx
    .select({ code: jobCards.code })
    .from(jobCards)
    .where(eq(jobCards.id, op.jobCardId))
    .limit(1);
  const jcCode = jcRows[0]?.code ?? '';

  const prevStatus = op.outsourceStatus ?? null;
  const newSentQty = Math.max(0, op.outsourceSentQty - qty);
  // Downgrade status only if we drained to 0 AND we were 'sent' (not yet
  // received-back — receive flow lands in T-059b and shouldn't downgrade).
  const nextStatus = newSentQty === 0 && prevStatus === 'sent' ? 'po_created' : prevStatus;
  const nextDcNo = op.outsourceDcNo === dcCode ? null : op.outsourceDcNo;

  await tx
    .update(jcOps)
    .set({
      outsourceSentQty: newSentQty,
      outsourceDcNo: nextDcNo,
      outsourceStatus: nextStatus as typeof op.outsourceStatus,
      updatedBy: adminUserId,
    })
    .where(eq(jcOps.id, op.id));

  return {
    fired: true,
    jcOpId: op.id,
    jcCode,
    opSeq: op.opSeq,
    prevStatus,
    nextStatus: nextStatus ?? 'sent',
    newSentQty,
  };
}

// (writeStoreTxnOnDcIssue / reverseStoreTxnOnDcCancel removed in ADR-067 —
// OSP send is stock-neutral; see the header note above.)
