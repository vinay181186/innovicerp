// ADR-282 — a Job Card against its Route Card: its routing as route-card ops, the
// live "does it differ" check for the detail read, and Send to Route Card.

import { and, asc, eq, isNull } from 'drizzle-orm';
import {
  ActivityAction,
  type CreateRouteCardOpInput,
  type JcRouteCardWriteBack,
} from '@innovic/shared';
import { jcOps, jobCards, machines, routeCards, vendors } from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { hasFormAccess } from '../../lib/access';
import { ConflictError, NotFoundError } from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';
import { hasPendingDocumentEdit } from '../document-edits/pending';
import { routingMatchesCard, saveRouteCardForItem } from '../route-cards/service';
import { assertJobCardNotPendingCancel } from './cancel';
import { recordRouteCardOutcome } from './route-card-outcome';
import type { JcOpInput } from './schema';

type RouteCardOpSource = Pick<
  JcOpInput,
  | 'operation'
  | 'machineCode'
  | 'cycleTimeMin'
  | 'program'
  | 'toolNo'
  | 'toolDetails'
  | 'qcRequired'
  | 'outsourceVendorCode'
>;

/** Translate this JC's ops into route-card ops for the auto-save (ADR-051's
 *  deferred write half). Same machine/vendor resolution buildOpRows does, so
 *  the saved route card carries live FKs where the codes resolved and the code
 *  text as fallback where they did not.
 *
 *  IMPORTANT: callers pass `input.ops` — the ops as the USER entered them, NOT
 *  the `withTerminalQcOp(input.ops)` result. The system-appended terminal QC op
 *  must never reach the route card, or the next plan would load it and get a
 *  second one appended on save (see stripAutoTerminalQcOp in route-cards).
 *
 *  A Job Card carries no Remarks or Lead Days: saveRouteCardForItem carries the
 *  card's own onto each step (ADR-282). */
export function toRouteCardOps(
  ops: RouteCardOpSource[],
  types: Array<CreateRouteCardOpInput['opType']>,
  machineMap: Map<string, string>,
  vendorMap: Map<string, string>,
): CreateRouteCardOpInput[] {
  return ops.map((o, i) => {
    const t = types[i]!;
    return {
      machineId: t === 'process' ? (machineMap.get(o.machineCode ?? '') ?? null) : null,
      machineCodeText: t === 'process' ? (o.machineCode ?? null) : t === 'qc' ? 'QC' : null,
      operation: o.operation,
      opType: t,
      cycleTimeMin: Number(o.cycleTimeMin || 0),
      program: o.program ?? null,
      toolNo: o.toolNo ?? null,
      toolDetails: o.toolDetails ?? null,
      qcRequired: t === 'qc' ? true : Boolean(o.qcRequired),
      ospVendorId: t === 'outsource' ? (vendorMap.get(o.outsourceVendorCode ?? '') ?? null) : null,
      ospVendorCodeText: t === 'outsource' ? (o.outsourceVendorCode ?? null) : null,
      ospLeadDays: null,
    };
  });
}

/** The Job Card's STORED routing as route-card ops, through toRouteCardOps. `lock`
 *  takes the jc_ops rows FOR UPDATE — the first lock on every Job Card path. */
async function loadJcRouteCardOps(
  tx: DbTransaction,
  companyId: string,
  jobCardId: string,
  opts: { lock?: boolean } = {},
): Promise<CreateRouteCardOpInput[]> {
  const base = tx
    .select({
      machineId: jcOps.machineId,
      machineCodeText: jcOps.machineCodeText,
      machineCode: machines.code,
      operation: jcOps.operation,
      opType: jcOps.opType,
      cycleTimeMin: jcOps.cycleTimeMin,
      program: jcOps.program,
      toolNo: jcOps.toolNo,
      toolDetails: jcOps.toolDetails,
      qcRequired: jcOps.qcRequired,
      outsourceVendorId: jcOps.outsourceVendorId,
      outsourceVendorText: jcOps.outsourceVendorText,
      vendorCode: vendors.code,
    })
    .from(jcOps)
    .leftJoin(machines, eq(machines.id, jcOps.machineId))
    .leftJoin(vendors, eq(vendors.id, jcOps.outsourceVendorId))
    .where(
      and(eq(jcOps.jobCardId, jobCardId), eq(jcOps.companyId, companyId), isNull(jcOps.deletedAt)),
    )
    .orderBy(asc(jcOps.opSeq));
  const rows = opts.lock ? await base.for('update', { of: jcOps }) : await base;
  const machineMap = new Map<string, string>();
  const vendorMap = new Map<string, string>();
  const ops = rows.map((r) => {
    const machineCode = r.machineCode ?? r.machineCodeText;
    const vendorCode = r.vendorCode ?? r.outsourceVendorText;
    if (r.machineId && machineCode) machineMap.set(machineCode, r.machineId);
    if (r.outsourceVendorId && vendorCode) vendorMap.set(vendorCode, r.outsourceVendorId);
    return {
      operation: r.operation,
      machineCode,
      cycleTimeMin: Number(r.cycleTimeMin),
      program: r.program,
      toolNo: r.toolNo,
      toolDetails: r.toolDetails,
      qcRequired: r.qcRequired,
      outsourceVendorCode: vendorCode,
    };
  });
  return toRouteCardOps(
    ops,
    rows.map((r) => r.opType),
    machineMap,
    vendorMap,
  );
}

/** Why a held-back routing cannot be sent right now; null = it can. */
async function sendBlockedReason(
  tx: DbTransaction,
  companyId: string,
  user: AuthContext,
  jc: { cancelled: boolean; itemRevisionId: string | null },
  card: { id: string; code: string; approvalStatus: string; itemRevisionId: string | null },
): Promise<string | null> {
  if (jc.cancelled) return 'This Job Card is cancelled.';
  // Send writes the card of the Job Card's OWN Item + Rev. If the card shown is
  // another Rev's, it would not be the card that changes.
  if (card.itemRevisionId !== jc.itemRevisionId) {
    return `Route Card ${card.code} belongs to another Drawing Rev.`;
  }
  if (!(await hasFormAccess(user, 'jc_create', 'edit'))) {
    return 'You do not have the right to edit this Job Card.';
  }
  if (card.approvalStatus === 'draft') return `Route Card ${card.code} is a Draft.`;
  if (card.approvalStatus === 'pending') return `Route Card ${card.code} is waiting for approval.`;
  if (card.approvalStatus === 'rejected') {
    return `Route Card ${card.code} was returned to its creator.`;
  }
  if (await hasPendingDocumentEdit(tx, companyId, 'RouteCard', card.id)) {
    return `Route Card ${card.code} already has a change waiting for approval.`;
  }
  return null;
}

/** The Job Card detail's live check (ADR-282). Null when there is no card. A Job
 *  Card on an older Rev never reads as different unless it held a change back:
 *  the card has moved on, not the Job Card. */
export async function readRouteCardSync(
  tx: DbTransaction,
  companyId: string,
  user: AuthContext,
  jc: {
    id: string;
    builtRevision: number | null;
    notSent: boolean;
    cancelled: boolean;
    itemRevisionId: string | null;
  },
  card: {
    id: string;
    code: string;
    currentRevision: number;
    approvalStatus: string;
    itemRevisionId: string | null;
  } | null,
): Promise<{ differs: boolean; canSend: boolean; blockedReason: string | null } | null> {
  if (!card) return null;
  const same = { differs: false, canSend: false, blockedReason: null };
  if (!jc.notSent && jc.builtRevision !== card.currentRevision) return same;
  // Compared on both paths: a flag set for a blank raw-material half, or a card
  // edited since to read the same, is not a different routing.
  const matches = await routingMatchesCard(
    tx,
    companyId,
    card.id,
    await loadJcRouteCardOps(tx, companyId, jc.id),
  );
  if (matches) return same;
  if (!jc.notSent) {
    const waiting = await hasPendingDocumentEdit(tx, companyId, 'RouteCard', card.id);
    return {
      differs: true,
      canSend: false,
      blockedReason: waiting ? `Route Card ${card.code} has a change waiting for approval.` : null,
    };
  }
  const blockedReason = await sendBlockedReason(tx, companyId, user, jc, card);
  return { differs: true, canSend: blockedReason === null, blockedReason };
}

/**
 * Send a held-back routing to the Route Card (ADR-282), in the caller's
 * transaction. Lock order as every Job Card path: jc_ops, then job_cards, then
 * route_cards (inside saveRouteCardForItem). The not-sent test runs under the
 * job_cards lock, so a double-click or a retry is refused, not sent twice.
 */
export async function sendToRouteCardTx(
  tx: DbTransaction,
  id: string,
  companyId: string,
  user: AuthContext,
): Promise<JcRouteCardWriteBack | null> {
  await assertJobCardNotPendingCancel(tx, id);
  const ops = await loadJcRouteCardOps(tx, companyId, id, { lock: true });
  const jc = (
    await tx
      .select({
        code: jobCards.code,
        itemId: jobCards.itemId,
        itemRevisionId: jobCards.itemRevisionId,
        notSent: jobCards.routeCardNotSent,
        routeCardId: jobCards.routeCardId,
        rawMaterialGradeId: jobCards.rawMaterialGradeId,
        rawMaterialGradeText: jobCards.rawMaterialGradeText,
        rawMaterialSizeId: jobCards.rawMaterialSizeId,
        rawMaterialSizeText: jobCards.rawMaterialSizeText,
      })
      .from(jobCards)
      .where(
        and(eq(jobCards.id, id), eq(jobCards.companyId, companyId), isNull(jobCards.deletedAt)),
      )
      .limit(1)
      .for('update')
  )[0];
  if (!jc) throw new NotFoundError('Job Card not found. It may have been moved to Trash.');
  if (!jc.notSent) {
    throw new ConflictError(
      `${jc.code} has no routing change waiting to be sent — reload the page to see the latest.`,
    );
  }
  if (jc.routeCardId) {
    const shown = (
      await tx
        .select({ code: routeCards.code, itemRevisionId: routeCards.itemRevisionId })
        .from(routeCards)
        .where(eq(routeCards.id, jc.routeCardId))
        .limit(1)
    )[0];
    if (shown && shown.itemRevisionId !== jc.itemRevisionId) {
      throw new ConflictError(`Route Card ${shown.code} belongs to another Drawing Rev.`);
    }
  }
  const writeBack = await saveRouteCardForItem(
    tx,
    companyId,
    jc.itemId,
    ops,
    user,
    jc.code,
    // As a save that did not send the RM pair (Review M1): grade and size may
    // fill a blank half, the RM item never moves from here.
    {
      rawMaterialGradeId: jc.rawMaterialGradeId,
      rawMaterialGradeText: jc.rawMaterialGradeText,
      rawMaterialSizeId: jc.rawMaterialSizeId,
      rawMaterialSizeText: jc.rawMaterialSizeText,
      rawMaterialItemId: null,
      rmQtyPerPiece: null,
    },
    jc.itemRevisionId,
    id,
  );
  await recordRouteCardOutcome(tx, id, writeBack, {
    companyId,
    itemId: jc.itemId,
    itemRevisionId: jc.itemRevisionId,
    userId: user.id,
  });
  const outcome = !writeBack
    ? 'it already reads the same'
    : writeBack.notSentReason
      ? `not sent: ${writeBack.notSentReason}`
      : writeBack.sentForApproval
        ? `${writeBack.routeCardCode} — sent for approval`
        : `${writeBack.routeCardCode} now Rev ${writeBack.routeCardRevision}`;
  await emitActivityLog(
    tx,
    {
      action: ActivityAction.Edit,
      entity: 'JobCard',
      entityId: id,
      refId: jc.code,
      detail: `Sent ${jc.code} routing to the Route Card — ${outcome}`,
    },
    companyId,
    user,
  );
  return writeBack;
}
