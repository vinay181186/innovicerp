// Outsource-balance action (ADR-081 dual-lane).
//
// A PROCESS op can carry an OSP balance: a user outsources the *remaining* qty
// of an in-progress in-house operation from the JC Operations board. This
// action (a) validates qty ≤ the op's `available`, (b) stamps the chosen
// outsource vendor on the op, and (c) raises a `jw_osp` Purchase Request for
// that qty. The existing PR→PO→DC→GRN→incoming-QC cascade then reconciles the
// output back as in-house + OSP-accepted — those steps are driven by the user
// via the existing OSP flow, NOT here.
//
// Unlike generateOspPrForOp (op-entry/osp-cascade.ts), this does NOT require an
// un-started, outsource-typed op and does NOT match a configured OSP process:
// the op stays op_type='process'. It reuses createPurchaseRequest (the same
// mechanism the standalone PR form uses), which stamps the source op
// (outsourceStatus='pr_raised' + outsourcePrId) atomically with the PR insert.
//
// ONE transaction, serialised per op. The op's `available` drops only when a
// DC is sent (outsource_sent_qty), not when a PR is raised — so the checks and
// the PR insert run in one transaction under an advisory lock keyed on the
// jc_op, and the qty already on live outsource PRs from this op (not yet sent)
// is held back. A double click or two users can no longer raise two PRs for
// the same Pending qty: the second waits for the first, then sees its PR.

import { ActivityAction, type OutsourceOpBalanceInput } from '@innovic/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { items, jcOps, jobCards, purchaseRequests, runningOps, vendors } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { assertProductionOrderNotShortClosed } from '../../lib/production-order-stop';
import { appendActivityLog } from '../activity-log/service';
import { jcOpRef } from '../op-entry/audit';
import { nextSeriesCode } from '../op-entry/osp-cascade';
import { insertPurchaseRequestTx, loadPrBalances } from '../purchase-requests/service';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

// Plain ISO date — matches the codebase's zoneless `date` columns.
function today(): string {
  // TODAY IN IST — the UTC date is still yesterday between 00:00 and 05:30 IST.
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** One live outsource PR raised from the op, for the reserve sum. */
export interface OpenOspPrQty {
  code: string;
  /** What this PR still stands for: its qty, or — once its balance is short
   *  closed — only the qty that actually reached a PO. */
  qty: number;
}

/** Qty on live outsource PRs from this op that has NOT yet gone out on a DC.
 *  `sentQty` is the op's outsource_sent_qty (every DC sent for this op, which
 *  `available` already subtracts) — taking it off here stops those pieces being
 *  counted twice. Pure, so the rule is testable without a database. */
export function openOspPrReserve(
  prs: readonly OpenOspPrQty[],
  sentQty: number,
): { reserved: number; codes: string[] } {
  const total = prs.reduce((sum, p) => sum + Math.max(0, p.qty), 0);
  const reserved = Math.max(0, Math.round((total - Math.max(0, sentQty)) * 1000) / 1000);
  return { reserved, codes: reserved > 0 ? prs.filter((p) => p.qty > 0).map((p) => p.code) : [] };
}

/** The refusal when the asked qty is more than what is left once live PRs
 *  are held back. null = the qty fits. */
export function outsourceQtyRefusal(
  qty: number,
  available: number,
  reserve: { reserved: number; codes: string[] },
): string | null {
  const pending = Math.max(0, Math.round((available - reserve.reserved) * 1000) / 1000);
  if (qty <= pending) return null;
  return (
    `Outsource Qty (${qty}) cannot be more than Pending (${pending}) on this operation — ` +
    `PR ${reserve.codes.join(', ')} already covers ${reserve.reserved}.`
  );
}

export interface OutsourceOpBalanceResult {
  prId: string;
  prCode: string;
}

export async function outsourceOpBalance(
  jcOpId: string,
  input: OutsourceOpBalanceInput,
  user: AuthContext,
): Promise<OutsourceOpBalanceResult> {
  // Outsourcing the balance of a started op rewrites the Job Card's routing —
  // an edit on jc_create (L3 Editor and up in Production).
  await requireFormAccess(user, 'jc_create', 'edit');
  // The PR below is raised through the shared create path inside this
  // transaction; that path leaves access to its caller, so check the same
  // right createPurchaseRequest checks (L2 Data Entry on pr_create).
  await requireFormAccess(user, 'pr_create', 'entry');
  const companyId = requireCompany(user);
  const { qty, vendorCode } = input;

  // One transaction — validate, resolve the vendor, stamp it on the op, and
  // raise the PR — so the op is never left with a vendor set but no PR, and
  // the Pending check below cannot go stale before the PR is written.
  const prep = await withUserContext(user, async (tx) => {
    // Serialise every outsource-balance save for THIS op until commit (same
    // pg_advisory_xact_lock(hashtext(...)) pattern as lockDocSeries). Taken
    // before any read so a second click waits, then sees the first PR.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`jc_op_outsource_balance:${jcOpId}`}))`,
    );

    const opRows = await tx
      .select({
        id: jcOps.id,
        jobCardId: jcOps.jobCardId,
        opSeq: jcOps.opSeq,
        operation: jcOps.operation,
        oldVendorText: jcOps.outsourceVendorText,
        sentQty: jcOps.outsourceSentQty,
      })
      .from(jcOps)
      .where(and(eq(jcOps.id, jcOpId), eq(jcOps.companyId, companyId), isNull(jcOps.deletedAt)))
      .limit(1);
    const op = opRows[0];
    if (!op) throw new NotFoundError('Operation not found. Refresh the page.');

    // ADR-182 — the dual-lane action raises a jw_osp purchase request and
    // stamps a vendor on the op, so it is a write like any other: refused once
    // the Job Card's Production Order has been short closed. The card id is
    // already in hand above, so the guard is called directly (one round trip
    // fewer than the jc_op-keyed variant, same answer).
    await assertProductionOrderNotShortClosed(tx, op.jobCardId);

    // Guard: an in-house machine session actively RUNNING on this op means those
    // pieces are being produced in-house right now — outsourcing them would
    // double-book the work (machine + vendor both making the same qty). Since a
    // running session carries no committed qty, `available` still counts those
    // pieces as outsourceable. Require the operator to stop the session first
    // (which records what was actually completed); then the true remaining
    // balance can be outsourced. isOsp=false = the in-house lane (not a vendor lane).
    const running = await tx
      .select({ id: runningOps.id })
      .from(runningOps)
      .where(
        and(
          eq(runningOps.jcOpId, jcOpId),
          eq(runningOps.status, 'running'),
          eq(runningOps.isOsp, false),
        ),
      )
      .limit(1);
    if (running.length > 0) {
      throw new ValidationError('Stop Operation first, then outsource the Pending qty.');
    }

    // `available` from the calc-engine view — the qty cleared for this op that
    // has not yet been consumed downstream (op-entry, QC, or an earlier OSP).
    const statusRows = (await tx.execute(sql`
      SELECT available, op_type, input_avail
      FROM public.v_jc_op_status
      WHERE jc_op_id = ${jcOpId}::uuid
    `)) as unknown as Array<{ available: number; op_type: string; input_avail: number }>;
    const available = Number(statusRows[0]?.available ?? 0);
    if (qty <= 0 || qty > available) {
      throw new ValidationError(
        `Outsource Qty (${qty}) cannot be more than Pending (${available}) on this operation.`,
      );
    }

    // Hold back what live outsource PRs from this op already cover. Live = not
    // deleted, not cancelled. A PR whose balance was short closed still counts
    // the qty that reached a PO (that part may still go out / has gone out on a
    // DC); its abandoned remainder frees up. outsource_sent_qty is netted off
    // inside openOspPrReserve because `available` already subtracts it.
    const livePrs = await tx
      .select({
        id: purchaseRequests.id,
        code: purchaseRequests.code,
        qty: purchaseRequests.qty,
        poId: purchaseRequests.poId,
        balanceClosedAt: purchaseRequests.balanceClosedAt,
      })
      .from(purchaseRequests)
      .where(
        and(
          eq(purchaseRequests.companyId, companyId),
          eq(purchaseRequests.sourceJcOpId, op.id),
          eq(purchaseRequests.prType, 'jw_osp'),
          isNull(purchaseRequests.deletedAt),
          sql`${purchaseRequests.status} <> 'cancelled'`,
        ),
      )
      .orderBy(purchaseRequests.code);
    const closedPrs = livePrs
      .filter((p) => p.balanceClosedAt != null)
      .map((p) => ({ ...p, qty: Number(p.qty) }));
    const balances = await loadPrBalances(tx, closedPrs);
    const reserve = openOspPrReserve(
      livePrs.map((p) => ({
        code: p.code,
        qty:
          p.balanceClosedAt != null
            ? Math.min(Number(p.qty), balances.get(p.id)?.orderedQty ?? 0)
            : Number(p.qty),
      })),
      Number(op.sentQty ?? 0),
    );
    const refusal = outsourceQtyRefusal(qty, available, reserve);
    if (refusal) throw new ConflictError(refusal);

    // Resolve the vendor by code within the company (the OSP register reads the
    // vendor off the op row).
    const vRows = await tx
      .select({ id: vendors.id, code: vendors.code })
      .from(vendors)
      .where(
        and(
          eq(vendors.code, vendorCode),
          eq(vendors.companyId, companyId),
          isNull(vendors.deletedAt),
        ),
      )
      .limit(1);
    const vendor = vRows[0];
    if (!vendor)
      throw new ValidationError(`Vendor "${vendorCode}" not found. Pick it again from the list.`);

    // JC + item for the PR line.
    const jcRows = await tx
      .select({ itemId: jobCards.itemId, itemName: items.name, jcCode: jobCards.code })
      .from(jobCards)
      .innerJoin(items, eq(items.id, jobCards.itemId))
      .where(and(eq(jobCards.id, op.jobCardId), eq(jobCards.companyId, companyId)))
      .limit(1);
    const jc = jcRows[0];
    if (!jc) throw new NotFoundError('Job Card not found. Refresh the page.');

    // Stamp the outsource vendor on the op (insertPurchaseRequestTx below stamps
    // outsourceStatus/outsourcePrId but not the vendor).
    await tx
      .update(jcOps)
      .set({
        outsourceVendorId: vendor.id,
        outsourceVendorText: vendor.code,
        updatedAt: new Date(),
        updatedBy: user.id,
      })
      .where(eq(jcOps.id, op.id));

    const prCode = await nextSeriesCode(tx, 'pr', companyId, 'IN-JWPR-');

    // Raise the jw_osp PR via the shared create path, in THIS transaction.
    // Passing sourceJcOpId makes it default prType='jw_osp' and stamp the op
    // (outsourceStatus='pr_raised' + outsourcePrId) atomically with the insert,
    // so a committed PR is never left without its op linked.
    const pr = await insertPurchaseRequestTx(
      tx,
      {
        code: prCode,
        prDate: today(),
        status: 'open',
        qty,
        estCost: 0,
        vendorId: vendor.id,
        itemId: jc.itemId,
        itemName: jc.itemName,
        operation: op.operation,
        sourceJcOpId: jcOpId,
      },
      user,
      companyId,
      { systemRaised: true },
    );

    return {
      pr,
      operation: op.operation,
      jobCardId: op.jobCardId,
      jcCode: jc.jcCode,
      opSeq: op.opSeq,
      oldVendorText: op.oldVendorText,
      vendorCode: vendor.code,
    };
  });

  const { pr } = prep;

  // ADR-197 — SEND on the Job Card: the qty outsourced, the vendor, the PR.
  // Its own transaction (the PR is committed with the transaction above);
  // the vendor change on the op rides along as before → after.
  await appendActivityLog(
    {
      action: ActivityAction.Send,
      entity: 'JobCard',
      entityId: prep.jobCardId,
      refId: prep.jcCode,
      opRef: jcOpRef(prep.opSeq, prep.operation),
      qty,
      changes:
        (prep.oldVendorText ?? null) !== prep.vendorCode
          ? [
              {
                field: 'outsourceVendorId',
                label: 'Vendor',
                before: prep.oldVendorText ?? null,
                after: prep.vendorCode,
              },
            ]
          : null,
      detail: `${prep.jcCode} ${jcOpRef(prep.opSeq, prep.operation)} — balance ${qty} outsourced to ${prep.vendorCode} (${pr.code})`,
    },
    user,
  );

  return { prId: pr.id, prCode: pr.code };
}
