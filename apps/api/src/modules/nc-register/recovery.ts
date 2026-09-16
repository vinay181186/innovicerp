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
import { SHIFTS, opSrNo } from '@innovic/shared';
import { jcOps, jobCards, machines, ncRegister, opLog, purchaseOrderLines } from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';
import { recalcPoHeaderStatus, recalcPoLineReceivedQty } from '../goods-receipt-notes/cascades';

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
 * dispatch, material) keeps working on the child.
 *
 * The recovery route is pre-filled by seedRecoveryOps: the operation that
 * actually MADE the rejected pieces (defaulted to the machine it ran on) plus a
 * terminal QC to re-inspect the rework. The route stays fully editable, and the
 * user can still add intermediate ops; the pre-fill just means the child opens
 * with a runnable route instead of an empty shell. When the child's terminal QC
 * is logged, onRecoveryJobCardQc settles the parent NC (§4).
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
  // display rule — see opSrNo in @innovic/shared
  const opPart = nc.opSeq != null ? ` Op ${opSrNo(nc.opSeq)}` : '';
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
  await seedRecoveryOps(tx, nc, parent.id, child.id, user);
  return child;
}

/**
 * Pre-fill the recovery route with the operation that produced the rejected
 * pieces + a terminal QC (design §4.3). Example: parent Op-1 CNC (made 10) →
 * Op-2 QC (5 rejected) yields a child with Op-1 = CNC on the machine that ran
 * it, Op-2 = QC. Skipped (child stays an empty shell) when the NC carries no
 * op, or the producing op cannot be identified from the parent route.
 *
 * The producing op is the reject op itself when that op is process/outsource,
 * else the latest non-QC op before it (a dedicated QC op inspects the op that
 * fed it). A vendor-sourced NC never reaches here — disposeNcCascade refuses
 * rework/repair for one — so the producing op is always in-house.
 */
async function seedRecoveryOps(
  tx: DbTransaction,
  nc: NcRow,
  parentId: string,
  childId: string,
  user: AuthContext,
): Promise<void> {
  if (nc.opSeq == null) return;
  const rejectSeq = nc.opSeq;

  const ops = await tx
    .select()
    .from(jcOps)
    .where(and(eq(jcOps.jobCardId, parentId), isNull(jcOps.deletedAt)))
    .orderBy(jcOps.opSeq);
  if (ops.length === 0) return;

  const rejectOp = ops.find((o) => o.opSeq === rejectSeq) ?? null;
  const producing =
    rejectOp && rejectOp.opType !== 'qc'
      ? rejectOp
      : (ops
          .filter((o) => o.opSeq < rejectSeq && o.opType !== 'qc')
          .sort((a, b) => b.opSeq - a.opSeq)[0] ?? null);
  if (!producing) return;

  // Default the producing op to the machine that ACTUALLY made the pieces
  // (nc.machineCodeText, captured by the op-entry auto-NC cascade), falling
  // back to the op's planned machine. Keep the id and the text consistent:
  // resolve the id from the actual code when it names a machine in the master.
  const actualCode = nc.machineCodeText ?? producing.machineCodeText;
  let machineId = producing.machineId;
  if (actualCode && actualCode !== producing.machineCodeText) {
    const m = await tx
      .select({ id: machines.id })
      .from(machines)
      .where(
        and(
          eq(machines.companyId, nc.companyId),
          eq(machines.code, actualCode),
          isNull(machines.deletedAt),
        ),
      )
      .limit(1);
    machineId = m[0]?.id ?? null;
  }

  await tx.insert(jcOps).values({
    companyId: nc.companyId,
    jobCardId: childId,
    opSeq: 1,
    operation: producing.operation,
    // Rework is performed in-house; a vendor/outsource source is guarded off.
    opType: producing.opType === 'outsource' ? 'process' : producing.opType,
    machineId,
    machineCodeText: actualCode,
    cycleTimeMin: producing.cycleTimeMin,
    program: producing.program,
    toolNo: producing.toolNo,
    toolDetails: producing.toolDetails,
    qcRequired: producing.qcRequired,
    createdBy: user.id,
    updatedBy: user.id,
  });

  // Terminal QC — its QC log is what onRecoveryJobCardQc keys on (last op) to
  // credit the recovered pieces back onto the parent's origin op.
  const qcName = rejectOp && rejectOp.opType === 'qc' ? rejectOp.operation : 'QC';
  await tx.insert(jcOps).values({
    companyId: nc.companyId,
    jobCardId: childId,
    opSeq: 2,
    operation: qcName,
    opType: 'qc',
    qcRequired: true,
    createdBy: user.id,
    updatedBy: user.id,
  });
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

/**
 * Propagate a settled recovery delta UP the whole parent chain (design §4,
 * nested rework). Starting from the JC a recovery just resolved on, credit its
 * parent NC and — when that NC itself sits on another recovery child — keep
 * climbing to the ORIGINAL parent. `accepted` pieces are credited (cleared) AND
 * re-injected into each ancestor's origin op, so they flow through that JC's
 * remaining downstream ops; `failed` (scrapped) pieces only move the ledger.
 * Each level is clamped to what the ancestor NC still owes, so a climb can never
 * over-credit, and it stops at a closed NC or the top of the chain.
 *
 * This is what lets a rework-of-a-rework's good pieces reach the original JC: a
 * partial 5-of-10 accepted on a grandchild shows 5 done on the child's origin op
 * AND 5 done on the parent's — and the same for a return-to-vendor replacement.
 */
export async function climbRecoveryToAncestors(
  tx: DbTransaction,
  fromJobCardId: string,
  accepted: number,
  failed: number,
  viaCode: string,
  logDate: string,
  shift: (typeof SHIFTS)[number],
  companyId: string,
  user: AuthContext,
): Promise<void> {
  let jcId = fromJobCardId;
  for (let guard = 0; guard < 50; guard++) {
    const jrows = await tx
      .select({ parentNcId: jobCards.parentNcId })
      .from(jobCards)
      .where(
        and(eq(jobCards.id, jcId), eq(jobCards.companyId, companyId), isNull(jobCards.deletedAt)),
      )
      .limit(1);
    const parentNcId = jrows[0]?.parentNcId ?? null;
    if (!parentNcId) return; // reached the original parent (not a recovery child)
    const nc = await loadNc(tx, parentNcId, companyId);
    if (nc.status === 'closed') return; // already settled above — do not re-touch
    const open = ncOpenQty(nc);
    const a = Math.max(0, Math.min(accepted, open));
    const f = Math.max(0, Math.min(failed, open - a));
    if (a + f > 0) {
      await creditRecovery(tx, nc, a, f, user);
      if (a > 0) {
        await reinjectIntoOriginOp(tx, nc, a, viaCode, logDate, shift, user);
      }
      await emitActivityLog(
        tx,
        {
          action: 'NC_RECOVERY_QC',
          entity: 'NonConformance',
          detail: `${nc.code} — recovery climbed from ${viaCode}: +${a} cleared${f ? `, +${f} failed` : ''}`,
          refId: nc.code,
        },
        companyId,
        user,
      );
    }
    jcId = nc.jobCardId; // climb to the JC this NC was raised on
  }
}

// ─── Hook: terminal QC on a rework / repair child (design §4) ─────────────

/**
 * Called by op-entry after a QC op_log insert. No-op unless the JC is a
 * recovery child (recovery_kind set) AND jcOpId is that JC's LAST op. Climbs the
 * ACCEPTED pieces up the whole parent chain (crediting each ancestor NC and
 * re-injecting into its origin op) so a partial or full recovery updates every
 * upstream JC, op by op, to the original parent.
 *
 * Rejected pieces are deliberately NOT booked as 'failed' on the parent here:
 * they are still in rework — op-entry's own auto-NC cascade has raised a fresh
 * NC on this child for them, and they become 'failed' on the ancestors only if
 * that NC is later scrapped (disposeNcCascade climbs the failed qty then). This
 * keeps the parent NC open until the pieces are genuinely recovered or scrapped,
 * instead of closing it as all-failed the moment a child rejects.
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
  const accepted = Math.max(0, Math.round(args.acceptedQty));
  const rejected = Math.max(0, Math.round(args.rejectedQty));
  if (accepted + rejected === 0) return;

  // Climb the ACCEPTED pieces up the entire parent chain. The child's rejected
  // pieces stay in rework on their own auto-NC (see the docstring); they are not
  // credited as failed here, so the parent NC stays open until they are truly
  // recovered or scrapped.
  if (accepted > 0) {
    await climbRecoveryToAncestors(
      tx,
      args.jobCardId,
      accepted,
      0,
      jc.code,
      args.logDate,
      toShift(args.shift),
      companyId,
      user,
    );
  }

  await emitActivityLog(
    tx,
    {
      action: 'NC_RECOVERY_QC',
      entity: 'NonConformance',
      detail: `${jc.code} terminal QC: accepted ${accepted}, rejected ${rejected} — accepted climbed to the parent chain`,
      refId: jc.code,
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
    // whenever a GRN on the line moves, and its formula subtracts only this
    // NC's OPEN qty (rejected − cleared − failed, both written by
    // creditRecovery above). Recomputing here is what makes the change land
    // now rather than at the next GRN. FAILED pieces move the line too: they
    // leave this NC's open qty and are carried by the follow-on NC Incoming
    // QC raised on the replacement line (subtracted again only once ITS
    // challan goes out) -- and Incoming QC's own line recalc ran BEFORE
    // creditRecovery wrote the new cleared/failed numbers, so this is the
    // only recalc that sees them. The header ladder follows the line so a
    // JWPO does not sit on "partial" with its line at 10 of 10.
    if (accepted > 0 || rejected > 0) {
      const poLineId = originOp.outsourcePoLineId;
      const read = async () =>
        (
          await tx
            .select({
              receivedQty: purchaseOrderLines.receivedQty,
              lineNo: purchaseOrderLines.lineNo,
              purchaseOrderId: purchaseOrderLines.purchaseOrderId,
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
              `(${accepted} replacement accepted, ${rejected} failed on ${nc.code})`,
            refId: nc.code,
          },
          companyId,
          user,
        );
      }
      if (after) {
        await recalcPoHeaderStatus(tx, after.purchaseOrderId, user.id);
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

  // If this NC sits on a recovery child, the accepted replacement pieces must
  // climb the parent chain too — same rule as an in-house rework recovery, so a
  // return-to-vendor replacement updates every upstream JC to the original
  // parent. No-op when the NC is on the original (top) JC.
  if (accepted > 0) {
    await climbRecoveryToAncestors(
      tx,
      nc.jobCardId,
      accepted,
      0,
      'replacement GRN',
      args.logDate,
      'day',
      companyId,
      user,
    );
  }
}
