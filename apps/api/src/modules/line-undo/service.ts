// ADR-324 line undo (P1) — read the Undo list of one JWSO line, and run its
// FIRST open step through that document's own service (its rights, blockers,
// ledger writes and approval stay its own). The only gate this module adds is
// the Undo chain Special Right, canUndoChain — read from the caller's
// effective access, never a role. A resent run is answered by the global
// Idempotency-Key plugin (ADR-172); a stale screen gets 409 naming the step
// that is first now.

import {
  canUndoChain,
  type JwLineUndoList,
  type RunLineUndoStepInput,
  type RunLineUndoStepResult,
} from '@innovic/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { userAccess, users } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { primeAccess, requireFormAccess } from '../../lib/access';
import { AuthorizationError, ConflictError, NotFoundError } from '../../lib/errors';
import { getMyAccess, toEffectiveAccess } from '../access-control/my-access';
import { requestCancel } from '../cancel-requests/service';
import { userDisplayName } from '../nc-register/recovery';
import { reverseOpLog } from '../op-entry/reverse-op-log';
import { stopOp } from '../op-entry/service';
import { returnPartyMaterialIssueToStore } from '../party-material-issues/service';
import { type BuiltStep, buildJwLineUndoSteps } from './jw-steps';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

/** The JWSO line, checked to belong to that JWSO in this company. */
async function readJwLine(
  tx: DbTransaction,
  companyId: string,
  jobWorkOrderId: string,
  lineId: string,
): Promise<{ lineNo: number; itemCode: string | null; orderQty: number }> {
  const rows = (await tx.execute(sql`
    SELECT l.line_no AS "lineNo", l.order_qty::float8 AS "orderQty",
           COALESCE(i.code, l.item_code_text) AS "itemCode"
      FROM public.job_work_order_lines l
      JOIN public.job_work_orders jw ON jw.id = l.job_work_order_id
      LEFT JOIN public.items i ON i.id = l.item_id
     WHERE l.id = ${lineId}::uuid AND l.job_work_order_id = ${jobWorkOrderId}::uuid
       AND l.company_id = ${companyId}::uuid AND l.deleted_at IS NULL AND jw.deleted_at IS NULL
  `)) as unknown as Array<{ lineNo: number; orderQty: number; itemCode: string | null }>;
  const r = rows[0];
  if (!r) throw new NotFoundError('JWSO line not found. Refresh the page.');
  return { lineNo: Number(r.lineNo), itemCode: r.itemCode, orderQty: Number(r.orderQty) };
}

/** Names of the company's active users who hold the Undo chain right — their
 *  access rows in ONE read, the rule asked of canUndoChain (never re-stated). */
async function undoHolderNames(tx: DbTransaction, companyId: string): Promise<string[]> {
  const rows = await tx
    .select({ fullName: users.fullName, email: users.email, access: userAccess })
    .from(users)
    .innerJoin(
      userAccess,
      and(
        eq(userAccess.userId, users.id),
        eq(userAccess.companyId, companyId),
        isNull(userAccess.deletedAt),
      ),
    )
    .where(and(eq(users.companyId, companyId), eq(users.isActive, true), isNull(users.deletedAt)));
  return rows
    .filter((r) => canUndoChain(toEffectiveAccess(r.access)))
    .map((r) => r.fullName?.trim() || r.email)
    .sort((a, b) => a.localeCompare(b));
}

export async function getJwLineUndoList(
  jobWorkOrderId: string,
  lineId: string,
  user: AuthContext,
): Promise<JwLineUndoList> {
  const companyId = requireCompany(user);
  await requireFormAccess(user, 'jw_create', 'view');
  // Access read once, before the transaction (the step builder asks it).
  await primeAccess(user);
  const canUndo = canUndoChain(await getMyAccess(user));
  return withUserContext(user, async (tx) => {
    const line = await readJwLine(tx, companyId, jobWorkOrderId, lineId);
    const steps = await buildJwLineUndoSteps(tx, companyId, lineId, user);
    return {
      jobWorkOrderId,
      lineId,
      lineNo: line.lineNo,
      itemCode: line.itemCode,
      orderQty: line.orderQty,
      canUndo,
      undoHolders: await undoHolderNames(tx, companyId),
      steps: steps.map((s) => s.step),
    };
  });
}

/** Today in IST, as the Op Entry Stop form sends it. */
function istNowParts(): { date: string; time: string } {
  const iso = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

/** Refuse unless `stepKey` is the first open step and can run now. */
function firstRunnable(steps: readonly BuiltStep[], stepKey: string): BuiltStep {
  const first = steps[0];
  if (!first) throw new ConflictError('Nothing holds this line any more. Refresh the page.');
  if (first.step.key !== stepKey) {
    throw new ConflictError(`Do ${first.step.docCode} first. Refresh the page.`);
  }
  if (first.step.state === 'waiting_approval') {
    throw new ConflictError(`${first.step.docCode} is waiting for approval.`);
  }
  if (first.step.state === 'manual' || first.run.kind === 'manual') {
    throw new ConflictError(
      first.step.manualReason ?? `${first.step.docCode} cannot be undone from this list.`,
    );
  }
  return first;
}

export async function runJwLineUndoStep(
  jobWorkOrderId: string,
  lineId: string,
  input: RunLineUndoStepInput,
  user: AuthContext,
): Promise<RunLineUndoStepResult> {
  const companyId = requireCompany(user);
  await primeAccess(user);
  if (!canUndoChain(await getMyAccess(user))) {
    throw new AuthorizationError('You do not hold the Undo chain right.');
  }
  const reason = input.reason.trim();
  const first = await withUserContext(user, async (tx) => {
    await readJwLine(tx, companyId, jobWorkOrderId, lineId);
    return firstRunnable(await buildJwLineUndoSteps(tx, companyId, lineId, user), input.stepKey);
  });
  const code = first.step.docCode;
  const run = first.run;

  // Each step runs through its own service, which checks its own rights.
  switch (run.kind) {
    case 'stop_op': {
      const now = istNowParts();
      await stopOp(
        run.runningOpId,
        {
          qty: 0,
          rejectQty: 0,
          logDate: now.date,
          logTime: now.time,
          shift: run.shift as 'day' | 'night' | 'general',
          ...(run.operatorId ? { operatorId: run.operatorId } : {}),
          operatorName: run.operatorName?.trim() || userDisplayName(user),
          remarks: `Stopped from the Undo list: ${reason}`.slice(0, 500),
        },
        user,
      );
      return { outcome: 'done', message: `${code} stopped` };
    }
    case 'reverse_op_log':
      await reverseOpLog(run.opLogId, { reason }, user);
      return { outcome: 'done', message: `${code} reversed` };
    case 'return_party_issue':
      await returnPartyMaterialIssueToStore(run.issueId, { qty: run.qty, reason }, user);
      return { outcome: 'done', message: `${code} returned to store` };
    case 'cancel': {
      const res = await requestCancel(
        run.docType,
        run.docId,
        { reason, approveNow: !first.step.needsApproval },
        user,
      );
      return res.cancelled
        ? { outcome: 'done', message: `${code} — done` }
        : { outcome: 'requested', message: `Sent for approval — ${code}` };
    }
    case 'manual':
      throw new ConflictError(first.step.manualReason ?? `${code} cannot be undone from this list.`);
  }
}
