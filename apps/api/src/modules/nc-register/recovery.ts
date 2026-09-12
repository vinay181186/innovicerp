// NC recovery — rework / repair child job cards, the closure gate, and the
// hooks the other modules call when recovered pieces come back through QC
// (docs/QC-NC-HANDLING-DESIGN.md §3–§5).
//
// Every function here runs inside the caller's transaction. The three `on*`
// hooks are invoked from op-entry, delivery-challans and incoming-qc AFTER
// they have written their own row, so a throw here rolls the whole event back
// — the inspection and the NC ledger move together or not at all.
//
// The quantity ledger on nc_register is the single truth for "where are the
// rejected pieces now":
//   open      = rejected − cleared − failed
//   at vendor = rtv_sent − rtv_received
// An NC closes only when open reaches zero (and, for return-to-vendor, when
// everything sent has come back). Closure happens automatically from the QC
// hooks; the manual Close button goes through the same gate.

import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { SHIFTS } from '@innovic/shared';
import { jcOps, jobCards, ncRegister, opLog, purchaseOrderLines } from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';
import { recalcPoLineReceivedQty } from '../goods-receipt-notes/cascades';

type NcRow = typeof ncRegister.$inferSelect;
export type RecoveryKind = 'rework' | 'repair';

/** The subset of an NC row the closure gate reads. Both the drizzle row and
 *  the raw-SQL list row satisfy it, so the mapper and the close paths share
 *  one function. `childJobCardCode` is optional because the write paths have
 *  the row but not the join; the message falls back to a generic phrase. */
export interface NcGateInput {
  status: NcRow['status'];
  disposition: NcRow['disposition'];
  rejectedQty: string | number;
  clearedQty: string | number;
  failedQty: string | number;
  rtvSentQty: string | number;
  rtvReceivedQty: string | number;
  reworkOpSeq: number | null;
  deliveryChallanId: string | null;
  childJobCardCode?: string | null;
}

const n = (v: string | number | null | undefined): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

/** Numeric columns come back as "5.00"; the ledger is whole pieces, so every
 *  message and every comparison works on the rounded integer. */
export const ncOpenQty = (
  nc: Pick<NcGateInput, 'rejectedQty' | 'clearedQty' | 'failedQty'>,
): number => Math.round(n(nc.rejectedQty) - n(nc.clearedQty) - n(nc.failedQty));

/** The name written into op_log.operator_name and nc.disposition_by_text when
 *  the system acts on a user's behalf. users has no name column beyond
 *  full_name, so the email's local part is the fallback — the same choice the
 *  disposition path has always made. */
export function userDisplayName(user: AuthContext): string {
  const full = user.fullName?.trim();
  if (full) return full;
  const local = user.email.split('@')[0];
  return local && local.length > 0 ? local : user.email;
}

// ─── Closure gate (interlock 6, Flow 9) ───────────────────────────────────

/**
 * Why this NC cannot close right now, or null when it can (or already has).
 * The string is shown verbatim next to the Close button and is the message of
 * the ConflictError a refused close throws, so it names the exact shortfall.
 */
export function ncCloseBlockedReason(nc: NcGateInput): string | null {
  if (nc.status === 'closed') return null;
  if (nc.status === 'pending') return 'No disposition chosen';

  const rejected = Math.round(n(nc.rejectedQty));
  const open = ncOpenQty(nc);
  const sent = Math.round(n(nc.rtvSentQty));
  const received = Math.round(n(nc.rtvReceivedQty));

  if (nc.status === 'under_rework' || nc.status === 'under_repair') {
    if (open > 0) {
      const where = nc.childJobCardCode ? ` on ${nc.childJobCardCode}` : '';
      const what = nc.status === 'under_rework' ? 'rework' : 'repair';
      return `${open} of ${rejected} pcs still under ${what}${where} — QC them first`;
    }
    return null;
  }

  if (nc.status === 'sent_to_vendor' || nc.status === 'received_qc_pending') {
    const atVendor = sent - received;
    if (atVendor > 0) {
      return `${atVendor} pcs still at vendor (sent ${sent}, received ${received})`;
    }
    const awaitingQc = received - Math.round(n(nc.clearedQty)) - Math.round(n(nc.failedQty));
    if (awaitingQc > 0) {
      return `${awaitingQc} pcs received from vendor awaiting Incoming QC`;
    }
    if (open > 0) {
      // The challan covered less than the NC owes — cannot happen through
      // createNcDc (it sends rejected_qty), but the gate must not lie if the
      // data was edited by hand.
      return `${open} of ${rejected} pcs not yet resolved`;
    }
    return null;
  }

  if (nc.status === 'disposed') {
    if (nc.disposition === 'return_to_vendor' && !nc.deliveryChallanId) {
      return 'Return-to-vendor challan not yet issued';
    }
    // Legacy in-route rework (rework_op_seq set) and rework_done rows close on
    // the operator's say-so, as they always have — the old closeNcRework path.
    return null;
  }

  // rework_done — legacy, closable.
  return null;
}

/** Mark an NC closed inside the caller's transaction. No gate here: the
 *  callers are the QC hooks (which have just made the gate true) and closeNc
 *  (which has already checked it). */
export async function markNcClosed(
  tx: DbTransaction,
  ncId: string,
  user: AuthContext,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await tx
    .update(ncRegister)
    .set({
      ...extra,
      status: 'closed',
      closedAt: new Date(),
      closedBy: user.id,
      updatedBy: user.id,
    })
    .where(eq(ncRegister.id, ncId));
}

// ─── Child rework / repair job card (design §4) ───────────────────────────

/**
 * Raise the child job card that recovers `qty` rejected pieces of `nc`.
 * Modelled on the make_fresh supplementary: item, drawing, SO/JW link and raw
 * material are copied from the parent so every downstream cascade (close,
 * dispatch, material) keeps working on the child. No jc_ops are written — the
 * user defines the recovery route (§4.3); job-cards appends the terminal QC op
 * whenever ops are saved on a card with recovery_kind set.
 */
export async function createRecoveryJobCard(
  tx: DbTransaction,
  nc: NcRow,
  kind: RecoveryKind,
  qty: number,
  user: AuthContext,
): Promise<{ id: string; code: string }> {
  const parentRows = await tx
    .select()
    .from(jobCards)
    .where(
      and(
        eq(jobCards.id, nc.jobCardId),
        eq(jobCards.companyId, nc.companyId),
        isNull(jobCards.deletedAt),
      ),
    )
    .limit(1);
  const parent = parentRows[0];
  if (!parent) throw new ValidationError(`Origin JC ${nc.jobCardId} not found`);

  const code = await nextRecoveryJcCode(tx, nc.companyId, parent.id, parent.code, kind);
  const label = kind === 'rework' ? 'Rework' : 'Repair';
  const opPart = nc.opSeq != null ? ` Op ${nc.opSeq}` : '';
  const today = new Date().toISOString().slice(0, 10);

  const inserted = await tx
    .insert(jobCards)
    .values({
      companyId: nc.companyId,
      code,
      jcDate: today,
      itemId: parent.itemId,
      orderQty: qty,
      priority: parent.priority,
      dueDate: parent.dueDate,
      drawingFilePath: parent.drawingFilePath,
      sourceSoLineId: parent.sourceSoLineId,
      sourceJwLineId: parent.sourceJwLineId,
      rawMaterialGradeId: parent.rawMaterialGradeId,
      rawMaterialGradeText: parent.rawMaterialGradeText,
      rawMaterialSizeId: parent.rawMaterialSizeId,
      rawMaterialSizeText: parent.rawMaterialSizeText,
      // The pieces already exist — nothing is cut for a recovery card, so the
      // party-material gate (ADR-103) must not hold its first op.
      clientMaterialGate: false,
      remarks: `${label} of ${parent.code}${opPart} — ${nc.code}`,
      parentNcId: nc.id,
      parentJobCardId: parent.id,
      originOpSeq: nc.opSeq,
      recoveryKind: kind,
      createdBy: user.id,
      updatedBy: user.id,
    })
    .returning({ id: jobCards.id, code: jobCards.code });
  const child = inserted[0];
  if (!child) throw new ValidationError(`Failed to create ${label.toLowerCase()} job card`);
  return child;
}

/** `<parentCode>-RW<n>` / `-RP<n>`, n = 1 + the parent's existing children of
 *  that kind. The count can lag a hand-deleted or hand-renamed card, so the
 *  candidate is bumped until no live card carries it. */
async function nextRecoveryJcCode(
  tx: DbTransaction,
  companyId: string,
  parentId: string,
  parentCode: string,
  kind: RecoveryKind,
): Promise<string> {
  const suffix = kind === 'rework' ? 'RW' : 'RP';
  const countRows = await tx
    .select({ c: sql<number>`count(*)::int` })
    .from(jobCards)
    .where(
      and(
        eq(jobCards.companyId, companyId),
        eq(jobCards.parentJobCardId, parentId),
        eq(jobCards.recoveryKind, kind),
        isNull(jobCards.deletedAt),
      ),
    );
  let next = (countRows[0]?.c ?? 0) + 1;
  for (;;) {
    const candidate = `${parentCode}-${suffix}${next}`;
    const dup = await tx
      .select({ id: jobCards.id })
      .from(jobCards)
      .where(
        and(
          eq(jobCards.companyId, companyId),
          eq(jobCards.code, candidate),
          isNull(jobCards.deletedAt),
        ),
      )
      .limit(1);
    if (dup.length === 0) return candidate;
    next += 1;
  }
}

// ─── Shared pieces of the two QC hooks ────────────────────────────────────

async function loadNc(tx: DbTransaction, ncId: string, companyId: string): Promise<NcRow> {
  const rows = await tx
    .select()
    .from(ncRegister)
    .where(
      and(
        eq(ncRegister.id, ncId),
        eq(ncRegister.companyId, companyId),
        isNull(ncRegister.deletedAt),
      ),
    )
    .limit(1);
  const nc = rows[0];
  if (!nc) throw new NotFoundError(`NC ${ncId} not found`);
  return nc;
}

/** Refuse a QC result that would credit more pieces than the NC still owes.
 *  The DB check constraint would catch it too, but as a constraint violation
 *  rather than a sentence the inspector can act on. */
function assertWithinOpen(nc: NcRow, accepted: number, rejected: number): void {
  const open = ncOpenQty(nc);
  if (accepted + rejected > open) {
    throw new ConflictError(
      `QC of ${accepted + rejected} pcs exceeds the ${open} pcs still open on ${nc.code}`,
    );
  }
}

/** Put recovered pieces back on the parent route: one op_log 'qc' row on the
 *  origin op, accepted qty, zero rejects. This is the same mechanism use_as_is
 *  has always used, so v_jc_op_status counts the pieces as that op's accepted
 *  output and the next op can pick them up. Skipped when the NC was raised
 *  without an op — nothing was ever taken away from any op, so there is
 *  nothing to put back. */
async function reinjectIntoOriginOp(
  tx: DbTransaction,
  nc: NcRow,
  accepted: number,
  via: string,
  logDate: string,
  shift: (typeof SHIFTS)[number],
  user: AuthContext,
): Promise<void> {
  if (accepted <= 0 || !nc.jcOpId) return;
  await tx.insert(opLog).values({
    companyId: nc.companyId,
    jcOpId: nc.jcOpId,
    logNo: `LOG-NC-${nc.code}`,
    logType: 'qc',
    logDate,
    shift,
    qty: accepted,
    rejectQty: 0,
    operatorId: null,
    operatorName: userDisplayName(user),
    qcUserId: user.id,
    machineId: null,
    remarks: `Recovered via ${via} — ${nc.code}`,
    createdBy: user.id,
  });
}

function toShift(v: string): (typeof SHIFTS)[number] {
  return (SHIFTS as readonly string[]).includes(v) ? (v as (typeof SHIFTS)[number]) : 'day';
}

/** Credit cleared/failed, close if the ledger is now settled, return the
 *  refreshed row so the caller can phrase its audit line. */
async function creditRecovery(
  tx: DbTransaction,
  nc: NcRow,
  accepted: number,
  rejected: number,
  user: AuthContext,
): Promise<{ cleared: number; failed: number; closed: boolean }> {
  const cleared = Math.round(n(nc.clearedQty)) + accepted;
  const failed = Math.round(n(nc.failedQty)) + rejected;
  const closed = cleared + failed >= Math.round(n(nc.rejectedQty));
  const ledger = { clearedQty: cleared.toFixed(2), failedQty: failed.toFixed(2) };
  if (closed) {
    await markNcClosed(tx, nc.id, user, ledger);
  } else {
    await tx
      .update(ncRegister)
      .set({ ...ledger, updatedBy: user.id })
      .where(eq(ncRegister.id, nc.id));
  }
  return { cleared, failed, closed };
}

// ─── Hook: terminal QC on a rework / repair child (design §4) ─────────────

/**
 * Called by op-entry after a QC op_log insert. No-op unless the JC is a
 * recovery child (recovery_kind set) AND jcOpId is that JC's LAST op. Credits
 * cleared/failed, re-injects accepted into the parent's origin op as an op_log
 * 'qc' row, auto-closes when cleared+failed == rejected. Emits NC_RECOVERY_QC.
 *
 * Rejected pieces need nothing extra here: op-entry's own auto-NC cascade has
 * already raised the follow-on NC against the child card.
 */
export async function onRecoveryJobCardQc(
  tx: DbTransaction,
  args: {
    jobCardId: string;
    jcOpId: string;
    acceptedQty: number;
    rejectedQty: number;
    qcLogId: string;
    logDate: string;
    shift: string;
  },
  companyId: string,
  user: AuthContext,
): Promise<void> {
  const jcRows = await tx
    .select({
      code: jobCards.code,
      recoveryKind: jobCards.recoveryKind,
      parentNcId: jobCards.parentNcId,
    })
    .from(jobCards)
    .where(
      and(
        eq(jobCards.id, args.jobCardId),
        eq(jobCards.companyId, companyId),
        isNull(jobCards.deletedAt),
      ),
    )
    .limit(1);
  const jc = jcRows[0];
  if (!jc || !jc.recoveryKind) return;

  // Only the terminal op's QC settles the NC: an intermediate QC op on the
  // recovery route is just a checkpoint, and crediting from it would let a
  // piece rejoin the parent before the recovery was finished.
  const thisOp = await tx
    .select({ opSeq: jcOps.opSeq })
    .from(jcOps)
    .where(and(eq(jcOps.id, args.jcOpId), eq(jcOps.jobCardId, args.jobCardId)))
    .limit(1);
  const lastOp = await tx
    .select({ opSeq: jcOps.opSeq })
    .from(jcOps)
    .where(and(eq(jcOps.jobCardId, args.jobCardId), isNull(jcOps.deletedAt)))
    .orderBy(desc(jcOps.opSeq))
    .limit(1);
  const thisSeq = thisOp[0]?.opSeq;
  const lastSeq = lastOp[0]?.opSeq;
  if (thisSeq == null || lastSeq == null || thisSeq !== lastSeq) return;

  if (!jc.parentNcId) {
    throw new NotFoundError(`Recovery job card ${jc.code} has no parent NC`);
  }
  const nc = await loadNc(tx, jc.parentNcId, companyId);
  const accepted = Math.max(0, Math.round(args.acceptedQty));
  const rejected = Math.max(0, Math.round(args.rejectedQty));
  if (accepted + rejected === 0) return;
  assertWithinOpen(nc, accepted, rejected);

  const ledger = await creditRecovery(tx, nc, accepted, rejected, user);
  await reinjectIntoOriginOp(tx, nc, accepted, jc.code, args.logDate, toShift(args.shift), user);

  await emitActivityLog(
    tx,
    {
      action: 'NC_RECOVERY_QC',
      entity: 'NonConformance',
      detail:
        `${nc.code} — ${jc.code} QC: accepted ${accepted}, rejected ${rejected}; ` +
        `cleared ${ledger.cleared}/${Math.round(n(nc.rejectedQty))}, failed ${ledger.failed}` +
        (ledger.closed ? '; CLOSED' : ''),
      refId: nc.code,
    },
    companyId,
    user,
  );
}

// ─── Hook: return-to-vendor challan received (design §5) ──────────────────

/**
 * Called by delivery-challans on receipt of a DC that has nc_id.
 * rtv_received_qty += receivedQty (cap at rtv_sent_qty → ConflictError),
 * status = 'received_qc_pending'. Emits NC_RTV_RECEIVED.
 */
export async function onNcChallanReceived(
  tx: DbTransaction,
  args: { ncId: string; receivedQty: number; deliveryChallanId: string },
  companyId: string,
  user: AuthContext,
): Promise<void> {
  const nc = await loadNc(tx, args.ncId, companyId);
  if (nc.deliveryChallanId && nc.deliveryChallanId !== args.deliveryChallanId) {
    throw new ConflictError(
      `Challan ${args.deliveryChallanId} is not the return-to-vendor challan on ${nc.code}`,
    );
  }
  const received = Math.max(0, Math.round(args.receivedQty));
  if (received === 0) return;
  const sent = Math.round(n(nc.rtvSentQty));
  const already = Math.round(n(nc.rtvReceivedQty));
  const total = already + received;
  if (total > sent) {
    throw new ConflictError(
      `Receiving ${received} pcs would exceed the ${sent} pcs sent on ${nc.code} ` +
        `(${already} already received)`,
    );
  }
  await tx
    .update(ncRegister)
    .set({
      rtvReceivedQty: total.toFixed(2),
      status: 'received_qc_pending',
      updatedBy: user.id,
    })
    .where(eq(ncRegister.id, nc.id));

  await emitActivityLog(
    tx,
    {
      action: 'NC_RTV_RECEIVED',
      entity: 'NonConformance',
      detail: `${nc.code} — received ${received} pcs from vendor (${total} of ${sent} sent)`,
      refId: nc.code,
    },
    companyId,
    user,
  );
}

// ─── Hook: Incoming QC on the vendor's replacement (design §5, §12.6) ─────

/**
 * Called by incoming-qc when the GRN has nc_id. cleared += accepted,
 * failed += rejected. If the NC's origin op has an outsource_po_line_id:
 * §12.6 purchase_order_lines.received_qty += accepted (emit
 * PO_RECEIVED_ADJUST). Otherwise re-inject accepted into the origin op as an
 * op_log 'qc' row exactly like onRecoveryJobCardQc. Auto-close when
 * cleared+failed == rejected. Emits NC_RECOVERY_QC.
 *
 * The two branches exist because a PO-linked GRN line already rolls into the
 * outsource op through v_jc_op_status (grn line → PO line → op), so writing an
 * op_log row as well would count the same pieces twice. An in-house origin op
 * has no such path, hence the op_log row.
 */
export async function onNcReplacementQc(
  tx: DbTransaction,
  args: {
    ncId: string;
    acceptedQty: number;
    rejectedQty: number;
    grnLineId: string;
    logDate: string;
  },
  companyId: string,
  user: AuthContext,
): Promise<void> {
  const nc = await loadNc(tx, args.ncId, companyId);
  const accepted = Math.max(0, Math.round(args.acceptedQty));
  const rejected = Math.max(0, Math.round(args.rejectedQty));
  if (accepted + rejected === 0) return;
  assertWithinOpen(nc, accepted, rejected);

  const ledger = await creditRecovery(tx, nc, accepted, rejected, user);

  const originOp = nc.jcOpId
    ? (
        await tx
          .select({ id: jcOps.id, outsourcePoLineId: jcOps.outsourcePoLineId })
          .from(jcOps)
          .where(and(eq(jcOps.id, nc.jcOpId), eq(jcOps.companyId, companyId)))
          .limit(1)
      )[0]
    : undefined;

  let viaText = 'replacement GRN';
  if (originOp?.outsourcePoLineId) {
    // §12.6 — cleared pieces rejoin the PO's supplied qty. Recomputed, not
    // added: received_qty is rebuilt from scratch by recalcPoLineReceivedQty
    // whenever a GRN on the line moves, and its formula already adds back
    // this NC's cleared_qty (written by creditRecovery above). Recomputing
    // here is what makes the add-back land now rather than at the next GRN.
    if (accepted > 0) {
      const poLineId = originOp.outsourcePoLineId;
      const read = async () =>
        (
          await tx
            .select({
              receivedQty: purchaseOrderLines.receivedQty,
              lineNo: purchaseOrderLines.lineNo,
            })
            .from(purchaseOrderLines)
            .where(eq(purchaseOrderLines.id, poLineId))
            .limit(1)
        )[0];
      const before = await read();
      await recalcPoLineReceivedQty(tx, poLineId, user.id);
      const after = await read();
      if (before && after) {
        await emitActivityLog(
          tx,
          {
            action: 'PO_RECEIVED_ADJUST',
            entity: 'PurchaseOrderLine',
            detail:
              `PO line ${before.lineNo} received_qty ${before.receivedQty} → ${after.receivedQty} ` +
              `(${accepted} replacement accepted on ${nc.code})`,
            refId: nc.code,
          },
          companyId,
          user,
        );
      }
    }
    viaText = 'replacement GRN (PO-linked)';
  } else {
    // No shift on a GRN-side inspection; 'day' matches what use_as_is writes.
    await reinjectIntoOriginOp(tx, nc, accepted, 'replacement GRN', args.logDate, 'day', user);
  }

  await emitActivityLog(
    tx,
    {
      action: 'NC_RECOVERY_QC',
      entity: 'NonConformance',
      detail:
        `${nc.code} — ${viaText} Incoming QC: accepted ${accepted}, rejected ${rejected}; ` +
        `cleared ${ledger.cleared}/${Math.round(n(nc.rejectedQty))}, failed ${ledger.failed}` +
        (ledger.closed ? '; CLOSED' : ''),
      refId: nc.code,
    },
    companyId,
    user,
  );
}
