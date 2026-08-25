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

import type { OutsourceOpBalanceInput } from '@innovic/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { items, jcOps, jobCards, runningOps, vendors } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { AuthorizationError, NotFoundError, ValidationError } from '../../lib/errors';
import { nextSeriesCode } from '../op-entry/osp-cascade';
import { createPurchaseRequest } from '../purchase-requests/service';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

// Plain ISO date — matches the codebase's zoneless `date` columns.
function today(): string {
  return new Date().toISOString().slice(0, 10);
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
  const companyId = requireCompany(user);
  const { qty, vendorCode } = input;

  // Phase 1 — validate, resolve the vendor, stamp it on the op, and reserve the
  // PR code. Runs in its own transaction so the op is never left with a vendor
  // set but no code reserved.
  const prep = await withUserContext(user, async (tx) => {
    const opRows = await tx
      .select({
        id: jcOps.id,
        jobCardId: jcOps.jobCardId,
        operation: jcOps.operation,
      })
      .from(jcOps)
      .where(and(eq(jcOps.id, jcOpId), eq(jcOps.companyId, companyId), isNull(jcOps.deletedAt)))
      .limit(1);
    const op = opRows[0];
    if (!op) throw new NotFoundError(`JC operation ${jcOpId} not found`);

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
      throw new ValidationError(
        'Stop the running machine session before outsourcing this operation — finish or stop the in-house run, then outsource the remaining balance.',
      );
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
        `Cannot outsource ${qty} — only ${available} available on this operation.`,
      );
    }

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
    if (!vendor) throw new ValidationError(`Vendor "${vendorCode}" not found in this company`);

    // JC + item for the PR line.
    const jcRows = await tx
      .select({ itemId: jobCards.itemId, itemName: items.name })
      .from(jobCards)
      .innerJoin(items, eq(items.id, jobCards.itemId))
      .where(and(eq(jobCards.id, op.jobCardId), eq(jobCards.companyId, companyId)))
      .limit(1);
    const jc = jcRows[0];
    if (!jc) throw new NotFoundError(`Job card for op ${jcOpId} not found`);

    // Stamp the outsource vendor on the op (createPurchaseRequest below stamps
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
    return {
      prCode,
      vendorId: vendor.id,
      itemId: jc.itemId,
      itemName: jc.itemName,
      operation: op.operation,
    };
  });

  // Phase 2 — raise the jw_osp PR via the shared create path. Passing
  // sourceJcOpId makes createPurchaseRequest default prType='jw_osp' and stamp
  // the op (outsourceStatus='pr_raised' + outsourcePrId) atomically with the
  // insert, so a committed PR is never left without its op linked.
  const pr = await createPurchaseRequest(
    {
      code: prep.prCode,
      prDate: today(),
      status: 'open',
      qty,
      estCost: 0,
      vendorId: prep.vendorId,
      itemId: prep.itemId,
      itemName: prep.itemName,
      operation: prep.operation,
      sourceJcOpId: jcOpId,
    },
    user,
  );

  return { prId: pr.id, prCode: pr.code };
}
