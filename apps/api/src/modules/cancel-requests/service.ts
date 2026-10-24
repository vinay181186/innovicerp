// ADR-235 Phase A — the standard Cancel Request.
//
// A live document is never deleted, only Cancelled. A holder of the page's
// EDIT tick sends a Cancel Request with a reason; a holder of its APPROVE tick
// approves (the requester may approve their own when they hold Approve;
// `approveNow` = request + approve in one call). Approval runs the document's
// own cancel worker (CANCEL_HANDLERS → xxxCancelTx) in ONE transaction:
// blockers re-checked, stock reversed, counters reopened. Reject / withdraw
// leave the document untouched. Never cascade — live downstream documents
// block and are named.
//
// LOCK ORDER (every path, so two of them can never deadlock): the DOCUMENT row
// first (handler.lock FOR UPDATE), THEN the cancel_requests row — by the insert
// (request) or by the conditional UPDATE that claims it (approve / reject /
// withdraw). The request row is read without a lock before that.
//
// §20.2: every status move on cancel_requests is a conditional UPDATE
// `WHERE id = ? AND status = 'pending'` with a row-count check; 0 rows → 409
// naming who decided and when. A 23505 on the pending-unique index → 409
// "already pending"; a 40P01 is answered 409 by the error handler (row-lock.ts).

import {
  ActivityAction,
  type CancelDocType,
  type CancelPreview,
  type CancelRequestResult,
  type decideCancelInputSchema,
  type requestCancelInputSchema,
} from '@innovic/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { cancelRequests } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { hasFormAccess, primeAccess, requireFormAccess } from '../../lib/access';
import { ConflictError, NotFoundError } from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';
import {
  alreadyDecidedMessage,
  alreadyPendingMessage,
  blockerRefusal,
  stagedEditMessage,
} from './messages';
import { CANCEL_HANDLERS } from './registry';
import { formKeyOf, pendingFor, requireCompany, rowById } from './rows';

export { assertNoPendingCancel } from './pending-guard';

/** The ActivityLog entity each enrolled document already logs under. */
const ACTIVITY_ENTITY: Record<CancelDocType, string> = {
  invoice: 'Invoice',
  jw_invoice: 'JwInvoice',
  customer_dispatch: 'Dispatch',
  jw_return: 'JwReturnChallan',
  customer_material_return: 'CustomerMaterialReturn',
  party_grn: 'PartyGrn',
  party_material_issue: 'PartyMaterialIssue',
  delivery_challan: 'DeliveryChallan',
  store_issue: 'StoreIssue',
  stock_count: 'StockCount',
  tool_issue: 'ToolIssue',
  purchase_request: 'PurchaseRequest',
  purchase_order: 'PurchaseOrder',
  jw_dc_outward: 'JwDcOutward',
  plan: 'Plan',
  job_work_order: 'JobWorkOrder',
  sales_order: 'SalesOrder',
  grn: 'GoodsReceiptNote',
};

type RequestDbRow = typeof cancelRequests.$inferSelect;

function isUniqueViolation(e: unknown): boolean {
  const o = e as { code?: unknown; cause?: { code?: unknown } } | null;
  return o?.code === '23505' || o?.cause?.code === '23505';
}

/** Read a request row — NO lock (lock order: the document comes first). */
async function readRequest(
  tx: DbTransaction,
  companyId: string,
  id: string,
): Promise<RequestDbRow> {
  const rows = await tx
    .select()
    .from(cancelRequests)
    .where(
      and(
        eq(cancelRequests.id, id),
        eq(cancelRequests.companyId, companyId),
        isNull(cancelRequests.deletedAt),
      ),
    )
    .limit(1);
  const req = rows[0];
  if (!req) throw new NotFoundError('Cancel request not found. Refresh the page.');
  return req;
}

/** 409 naming who decided it and when (the request is no longer pending). */
async function decidedConflict(tx: DbTransaction, companyId: string, id: string): Promise<never> {
  const row = await rowById(tx, companyId, id);
  throw new ConflictError(
    alreadyDecidedMessage(row.docCode, row.status, row.decidedByName, row.decidedAt),
    { request: row },
  );
}

/** Lock the document FOR UPDATE; 404 when missing, 409 when already cancelled
 *  (unless `allowCancelled` — reject / withdraw only need the lock). */
async function lockDocument(
  tx: DbTransaction,
  companyId: string,
  docType: CancelDocType,
  docId: string,
  allowCancelled = false,
): Promise<string> {
  const doc = await CANCEL_HANDLERS[docType].lock(tx, companyId, docId, true);
  if (!doc) throw new NotFoundError('Document not found. Refresh the page.');
  if (doc.cancelled && !allowCancelled) {
    throw new ConflictError(`${doc.code} is already Cancelled. Reload the page.`);
  }
  return doc.code;
}

/** Everything that refuses a cancel right now: a pending staged edit on the
 *  document (ADR-202), then the worker's own blockers. */
async function refuseIfBlocked(
  tx: DbTransaction,
  companyId: string,
  docType: CancelDocType,
  docId: string,
  docCode: string,
): Promise<void> {
  const handler = CANCEL_HANDLERS[docType];
  if (handler.editEntity) {
    const staged = (await tx.execute(sql`
      SELECT 1 FROM public.document_edit_requests
      WHERE company_id = ${companyId}::uuid AND entity = ${handler.editEntity}
        AND entity_id = ${docId}::uuid AND status = 'pending' AND deleted_at IS NULL
      LIMIT 1
    `)) as unknown as unknown[];
    if (staged.length > 0) throw new ConflictError(stagedEditMessage(docCode));
  }
  const blockers = await handler.blockers(tx, companyId, docId);
  if (blockers.length > 0) throw new ConflictError(blockerRefusal(docCode, blockers), { blockers });
}

/** §20.2 — move a still-pending request to `status`; 0 rows → 409. */
async function claim(
  tx: DbTransaction,
  companyId: string,
  id: string,
  status: 'approved' | 'rejected' | 'withdrawn',
  user: AuthContext,
  note?: string,
): Promise<void> {
  const moved = await tx
    .update(cancelRequests)
    .set({
      status,
      // Withdraw records who pulled it back, and when, so a second decider's
      // 409 names them.
      decidedBy: user.id,
      decidedAt: new Date(),
      ...(note !== undefined ? { decisionNote: note } : {}),
      updatedBy: user.id,
      updatedAt: new Date(),
    })
    .where(and(eq(cancelRequests.id, id), eq(cancelRequests.status, 'pending')))
    .returning({ id: cancelRequests.id });
  if (moved.length === 0) await decidedConflict(tx, companyId, id);
}

export async function getCancelPreview(
  docType: CancelDocType,
  docId: string,
  user: AuthContext,
): Promise<CancelPreview> {
  const companyId = requireCompany(user);
  const formKey = formKeyOf(docType);
  await requireFormAccess(user, formKey, 'view');
  const [canRequest, canApprove] = await Promise.all([
    hasFormAccess(user, formKey, 'edit'),
    hasFormAccess(user, formKey, 'approve'),
  ]);
  const handler = CANCEL_HANDLERS[docType];

  return withUserContext(user, async (tx) => {
    // Read only — every detail page loads this for the pending banner.
    const doc = await handler.lock(tx, companyId, docId, false);
    if (!doc) throw new NotFoundError('Document not found. Refresh the page.');
    const pending = await pendingFor(tx, companyId, docType, docId);
    const live = !doc.cancelled;
    return {
      docType,
      docId,
      docCode: doc.code,
      alreadyCancelled: doc.cancelled,
      canRequest,
      canApprove,
      pending,
      blockers: live ? await handler.blockers(tx, companyId, docId) : [],
      effects: live ? await handler.effects(tx, companyId, docId) : [],
    };
  });
}

// ─── Approve (shared by decide + approveNow) ────────────────────────────────

async function approveInTx(
  tx: DbTransaction,
  companyId: string,
  req: { id: string; docType: string; docId: string; reason: string },
  user: AuthContext,
): Promise<void> {
  const docType = req.docType as CancelDocType;
  // 1. The document lock (re-entrant within approveNow's transaction). A
  //    cancelled document is refused only after the claim below, so a second
  //    approver racing the first is told who approved, not just "cancelled".
  const doc = await CANCEL_HANDLERS[docType].lock(tx, companyId, req.docId, true);
  if (!doc) throw new NotFoundError('Document not found. Refresh the page.');
  // 2. Claim the request — only a still-pending row moves to approved.
  await claim(tx, companyId, req.id, 'approved', user);
  if (doc.cancelled) throw new ConflictError(`${doc.code} is already Cancelled. Reload the page.`);
  const docCode = doc.code;
  // 3. Re-check what blocks — a downstream document may have appeared since the
  //    request. Any throw rolls the claim back too.
  await refuseIfBlocked(tx, companyId, docType, req.docId, docCode);
  // 4. The document's own cancel worker — the one writer (§20.1). It logs the
  //    CANCEL with the request's reason under the approver's name.
  await CANCEL_HANDLERS[docType].run(tx, companyId, req.docId, req.reason, user);
}

// ─── Request ────────────────────────────────────────────────────────────────

export async function requestCancel(
  docType: CancelDocType,
  docId: string,
  input: z.output<typeof requestCancelInputSchema>,
  user: AuthContext,
): Promise<CancelRequestResult> {
  const companyId = requireCompany(user);
  const formKey = formKeyOf(docType);
  await requireFormAccess(user, formKey, 'edit');
  if (input.approveNow) await requireFormAccess(user, formKey, 'approve');

  return withUserContext(user, async (tx) => {
    // Document first (lock order), then the request row via the insert.
    const docCode = await lockDocument(tx, companyId, docType, docId);
    await refuseIfBlocked(tx, companyId, docType, docId, docCode);

    let requestId: string;
    try {
      // Savepoint: a 23505 aborts only this insert, so the 409 below can still
      // read who holds the open request.
      requestId = await tx.transaction(async (sp) => {
        const [ins] = await sp
          .insert(cancelRequests)
          .values({
            companyId,
            docType,
            docId,
            docCode,
            reason: input.reason,
            status: 'pending',
            requestedBy: user.id,
            createdBy: user.id,
            updatedBy: user.id,
          })
          .returning({ id: cancelRequests.id });
        return ins!.id;
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      const open = await pendingFor(tx, companyId, docType, docId);
      throw new ConflictError(alreadyPendingMessage(docCode, open?.requestedByName ?? null), {
        request: open,
      });
    }

    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Request,
        entity: ACTIVITY_ENTITY[docType],
        entityId: docId,
        refId: docCode,
        reason: input.reason,
        detail: `${docCode} — cancel requested`,
      },
      companyId,
      user,
    );

    if (input.approveNow) {
      await approveInTx(
        tx,
        companyId,
        { id: requestId, docType, docId, reason: input.reason },
        user,
      );
    }
    return { request: await rowById(tx, companyId, requestId), cancelled: input.approveNow };
  });
}

// ─── Decide (approve / reject) ──────────────────────────────────────────────

export async function decideCancelRequest(
  requestId: string,
  input: z.output<typeof decideCancelInputSchema>,
  user: AuthContext,
): Promise<CancelRequestResult> {
  const companyId = requireCompany(user);
  // The Approve check runs once the request row is read (its page is on the
  // row), so the access read happens now, outside the transaction.
  await primeAccess(user);

  return withUserContext(user, async (tx) => {
    const req = await readRequest(tx, companyId, requestId);
    const docType = req.docType as CancelDocType;
    await requireFormAccess(user, formKeyOf(docType), 'approve');
    if (req.status !== 'pending') await decidedConflict(tx, companyId, req.id);

    if (input.decision === 'approve') {
      await approveInTx(tx, companyId, req, user);
      return { request: await rowById(tx, companyId, req.id), cancelled: true };
    }

    // Reject: same lock order — document, then the request row.
    await lockDocument(tx, companyId, docType, req.docId, true);
    const note = (input.note ?? '').trim();
    await claim(tx, companyId, req.id, 'rejected', user, note);
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Reject,
        entity: ACTIVITY_ENTITY[docType],
        entityId: req.docId,
        refId: req.docCode,
        reason: note,
        detail: `${req.docCode} — cancel request rejected`,
      },
      companyId,
      user,
    );
    return { request: await rowById(tx, companyId, req.id), cancelled: false };
  });
}

// ─── Withdraw ───────────────────────────────────────────────────────────────

export async function withdrawCancelRequest(
  requestId: string,
  user: AuthContext,
): Promise<CancelRequestResult> {
  const companyId = requireCompany(user);
  await primeAccess(user);

  return withUserContext(user, async (tx) => {
    const req = await readRequest(tx, companyId, requestId);
    const docType = req.docType as CancelDocType;
    // The requester, or anyone who may approve cancels on that page.
    if (req.requestedBy !== user.id) await requireFormAccess(user, formKeyOf(docType), 'approve');
    if (req.status !== 'pending') await decidedConflict(tx, companyId, req.id);

    await lockDocument(tx, companyId, docType, req.docId, true);
    await claim(tx, companyId, req.id, 'withdrawn', user);
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Withdraw,
        entity: ACTIVITY_ENTITY[docType],
        entityId: req.docId,
        refId: req.docCode,
        detail: `${req.docCode} — cancel request withdrawn`,
      },
      companyId,
      user,
    );
    return { request: await rowById(tx, companyId, req.id), cancelled: false };
  });
}

export { listCancelRequests } from './list';
