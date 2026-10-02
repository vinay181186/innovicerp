// Approvals inbox (ADR-190) — GET /approvals/inbox.
//
// One read that answers "what is waiting for ME to sign off". It owns no
// rules of its own: each list comes from the module that owns the approval,
// applying that approve endpoint's own eligibility checks, so a row here is
// always one the caller's Approve button would accept.
//
//   pr       — purchase-requests/approval-inbox.ts (approvePurchaseRequest's rules)
//   po       — purchase-orders/approval-inbox.ts   (approvePurchaseOrder's rules)
//   logEntry — op-entry's pending date/time corrections (ADR-130), which only a
//              manager/admin may decide (decideOpLogTimeChange)

import type { ApprovalInboxResponse, ApprovalInboxRow } from '@innovic/shared';
import { opSrNo } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { isWriteRole } from '../../lib/auth';
import { AuthorizationError } from '../../lib/errors';
import { listOpLogTimeChangeRequests } from '../op-entry/service';
import { listPoApprovalInbox, loadPoInboxAccess } from '../purchase-orders/approval-inbox';
import { listPrApprovalInbox, loadPrInboxAccess } from '../purchase-requests/approval-inbox';

/** The most log-entry requests the list endpoint will return in one read. */
const LOG_ENTRY_LIMIT = 200;

export async function getApprovalInbox(user: AuthContext): Promise<ApprovalInboxResponse> {
  const companyId = user.companyId;
  if (!companyId) throw new AuthorizationError('User is not assigned to a company');

  // Access checks each open their own transaction, so they run first — never
  // inside the inbox transaction below (see clients/related.ts).
  const prAccess = await loadPrInboxAccess(user);
  const poAccess = await loadPoInboxAccess(user);
  const { pr, po } = await withUserContext(user, async (tx) => ({
    pr: await listPrApprovalInbox(tx, companyId, user, prAccess),
    po: await listPoApprovalInbox(tx, companyId, user, poAccess),
  }));

  let logEntry: ApprovalInboxRow[] = [];
  let logEntryCount = 0;
  if (isWriteRole(user)) {
    // The count is the whole waiting queue (ADR-201) — the list below stops at
    // LOG_ENTRY_LIMIT. Same rows selectTimeChangeRequests can return: its
    // inner joins (op_log, a live jc_op, its job card) are repeated here.
    const [c] = (await withUserContext(user, (tx) =>
      tx.execute(sql`
        SELECT COUNT(*)::int AS n
        FROM public.op_log_time_change_requests r
        JOIN public.op_log l ON l.id = r.op_log_id
        JOIN public.jc_ops o ON o.id = r.jc_op_id AND o.deleted_at IS NULL
        JOIN public.job_cards jc ON jc.id = o.job_card_id
        WHERE r.company_id = ${companyId}::uuid
          AND r.deleted_at IS NULL
          AND r.status = 'pending'
      `),
    )) as unknown as Array<{ n: number }>;
    logEntryCount = Number(c?.n ?? 0);
    const requests = await listOpLogTimeChangeRequests(
      { status: 'pending', limit: LOG_ENTRY_LIMIT },
      user,
    );
    logEntry = requests.map((r) => ({
      id: r.id,
      docCode: `${r.jobCardCode} · Op #${opSrNo(r.opSeq)}`,
      vendorName: null,
      itemCode: r.itemCode,
      itemName: r.itemName,
      docQty: r.qty,
      docAmount: null,
      createdByName: r.requestedByName,
      createdAt: r.requestedAt,
      navPage: '/approvals',
    }));
  }

  return {
    counts: { pr: pr.length, po: po.length, logEntry: logEntryCount },
    pr,
    po,
    logEntry,
  };
}
