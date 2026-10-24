// Approvals inbox (ADR-190) — GET /approvals/inbox.
//
// One read that answers "what is waiting for ME to sign off". It owns no
// rules of its own: each list comes from the module that owns the approval,
// applying that approve endpoint's own eligibility checks, so a row here is
// always one the caller's Approve button would accept.
//
//   pr       — purchase-requests/approval-inbox.ts (approvePurchaseRequest's rules)
//   po       — purchase-orders/approval-inbox.ts   (approvePurchaseOrder's rules)
//   rc       — route-cards/approval-inbox.ts       (approveRouteCard's rules, ADR-253)
//   logEntry — op-entry's pending date/time corrections (ADR-130), shown to
//              whoever holds Approve on Operation Entry or QC Submit (ADR-232, D7)

import type { ApprovalInboxResponse, ApprovalInboxRow } from '@innovic/shared';
import { opSrNo } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { hasFormAccess } from '../../lib/access';
import { AuthorizationError } from '../../lib/errors';
import { selectTimeChangeRequests } from '../op-entry/service';
import { decidableTimeChangeScope } from '../op-entry/time-change-page';
import { listPoApprovalInbox, loadPoInboxAccess } from '../purchase-orders/approval-inbox';
import { listPrApprovalInbox, loadPrInboxAccess } from '../purchase-requests/approval-inbox';
import { listRcApprovalInbox, loadRcInboxAccess } from '../route-cards/approval-inbox';

/** The most log-entry requests the list endpoint will return in one read. */
const LOG_ENTRY_LIMIT = 200;

export async function getApprovalInbox(user: AuthContext): Promise<ApprovalInboxResponse> {
  const companyId = user.companyId;
  if (!companyId) throw new AuthorizationError('User is not assigned to a company');

  // Access checks each open their own transaction, so they run first — never
  // inside the inbox transaction below (see clients/related.ts).
  // Independent reads, so they run together (the access row is remembered for
  // the request, ADR-229).
  const [prAccess, poAccess, rcAccess, opApprove, qcApprove] = await Promise.all([
    loadPrInboxAccess(user),
    loadPoInboxAccess(user),
    loadRcInboxAccess(user),
    hasFormAccess(user, 'op_entry', 'approve'),
    hasFormAccess(user, 'qc_submit', 'approve'),
  ]);
  const canDecideLogEntry = opApprove || qcApprove;
  // ADR-232: only the rows this caller can decide (QC rows on QC Approve,
  // production rows on Op Entry Approve) — in the count AND the list.
  const logScope = canDecideLogEntry ? await decidableTimeChangeScope(user) : sql`AND false`;
  // Started now, awaited after the log-entry reads, so they run together.
  const prPo = withUserContext(user, async (tx) => ({
    pr: await listPrApprovalInbox(tx, companyId, user, prAccess),
    po: await listPoApprovalInbox(tx, companyId, user, poAccess),
    rc: await listRcApprovalInbox(tx, companyId, rcAccess),
  }));
  // If the log-entry reads throw first, this must not become an unhandled
  // rejection (it would crash the process); its own error surfaces at the await.
  prPo.catch(() => undefined);

  let logEntry: ApprovalInboxRow[] = [];
  let logEntryCount = 0;
  if (canDecideLogEntry) {
    // The count is the whole waiting queue (ADR-201) — the list below stops at
    // LOG_ENTRY_LIMIT. Same rows selectTimeChangeRequests can return: its
    // inner joins (op_log, a live jc_op, its job card) are repeated here.
    const [countRows, requests] = await Promise.all([
      withUserContext(user, (tx) =>
        tx.execute(sql`
        SELECT COUNT(*)::int AS n
        FROM public.op_log_time_change_requests r
        JOIN public.op_log l ON l.id = r.op_log_id
        JOIN public.jc_ops o ON o.id = r.jc_op_id AND o.deleted_at IS NULL
        JOIN public.job_cards jc ON jc.id = o.job_card_id
        WHERE r.company_id = ${companyId}::uuid
          AND r.deleted_at IS NULL
          AND r.status = 'pending'
          ${logScope}
      `),
      ),
      withUserContext(user, (tx) =>
        selectTimeChangeRequests(tx, companyId, {
          status: 'pending',
          limit: LOG_ENTRY_LIMIT,
          where: logScope,
        }),
      ),
    ]);
    const [c] = countRows as unknown as Array<{ n: number }>;
    logEntryCount = Number(c?.n ?? 0);
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

  const { pr, po, rc } = await prPo;
  return {
    counts: { pr: pr.length, po: po.length, logEntry: logEntryCount, rc: rc.length },
    pr,
    po,
    logEntry,
    rc,
  };
}
