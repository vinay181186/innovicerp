// Approvals inbox (ADR-190) — GET /approvals/inbox.
//
// One read that answers "what is waiting for ME to sign off". It owns no
// rules of its own: each list comes from the module that owns the approval,
// applying that approve endpoint's own eligibility checks, so a row here is
// always one the caller's Approve button would accept.
//
//   pr       — always empty: PRs have no approval (owner rule 2026-10-31). The
//              key stays because the shared response shape carries it.
//   po       — purchase-orders/approval-inbox.ts   (approvePurchaseOrder's rules)
//   rc       — route-cards/approval-inbox.ts       (approveRouteCard's rules, ADR-253)
//   logEntry — op-entry's pending date/time corrections (ADR-130), shown to
//              whoever holds Approve on Operation Entry or QC Submit (ADR-232, D7)
//
// readApprovalInbox is the shared read; GET /approvals/waiting (ADR-265,
// ./waiting.ts) builds its merged list from the same answer.

import type {
  ApprovalInboxResponse,
  ApprovalInboxRow,
  OpLogTimeChangeRequest,
} from '@innovic/shared';
import { opSrNo } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { hasFormAccess } from '../../lib/access';
import { AuthorizationError } from '../../lib/errors';
import { selectTimeChangeRequests } from '../op-entry/service';
import { decidableTimeChangeScope } from '../op-entry/time-change-page';
import {
  listPoApprovalInbox,
  loadPoInboxAccess,
  type PoInboxAccess,
} from '../purchase-orders/approval-inbox';
import {
  listRcWaiting,
  loadRcInboxAccess,
  type RcInboxAccess,
  type RcWaitingRow,
} from '../route-cards/approval-inbox';

/** The most log-entry requests the list endpoint will return in one read. */
const LOG_ENTRY_LIMIT = 200;

/** A waiting op-log time change plus the Job Card it belongs to. */
export interface LogEntryWaiting {
  request: OpLogTimeChangeRequest;
  jobCardId: string | null;
}

/** Everything the inbox reads, before it is shaped for a response — shared by
 *  GET /approvals/inbox (below) and GET /approvals/waiting (ADR-265). */
export interface ApprovalInboxRead {
  poAccess: PoInboxAccess;
  rcAccess: RcInboxAccess;
  canDecideLogEntry: boolean;
  po: ApprovalInboxRow[];
  rc: RcWaitingRow[];
  logEntry: LogEntryWaiting[];
  /** The whole waiting log-entry queue (logEntry stops at LOG_ENTRY_LIMIT). */
  logEntryCount: number;
}

export async function readApprovalInbox(user: AuthContext): Promise<ApprovalInboxRead> {
  const companyId = user.companyId;
  if (!companyId) throw new AuthorizationError('User is not assigned to a company');

  // Access checks each open their own transaction, so they run first — never
  // inside the inbox transaction below (see clients/related.ts).
  // Independent reads, so they run together (the access row is remembered for
  // the request, ADR-229).
  const [poAccess, rcAccess, opApprove, qcApprove] = await Promise.all([
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
    po: await listPoApprovalInbox(tx, companyId, user, poAccess),
    rc: await listRcWaiting(tx, companyId, rcAccess),
  }));
  // If the log-entry reads throw first, this must not become an unhandled
  // rejection (it would crash the process); its own error surfaces at the await.
  prPo.catch(() => undefined);

  let logEntry: LogEntryWaiting[] = [];
  let logEntryCount = 0;
  if (canDecideLogEntry) {
    // The count is the whole waiting queue (ADR-201) — the list below stops at
    // LOG_ENTRY_LIMIT. Same rows selectTimeChangeRequests can return: its
    // inner joins (op_log, a live jc_op, its job card) are repeated here.
    const [countRows, listed] = await Promise.all([
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
      withUserContext(user, async (tx) => {
        const requests = await selectTimeChangeRequests(tx, companyId, {
          status: 'pending',
          limit: LOG_ENTRY_LIMIT,
          where: logScope,
        });
        return requests.map((request) => ({
          request,
          jobCardId: request.jobCardId ?? null,
        }));
      }),
    ]);
    const [c] = countRows as unknown as Array<{ n: number }>;
    logEntryCount = Number(c?.n ?? 0);
    logEntry = listed;
  }

  const { po, rc } = await prPo;
  return { poAccess, rcAccess, canDecideLogEntry, po, rc, logEntry, logEntryCount };
}

export async function getApprovalInbox(user: AuthContext): Promise<ApprovalInboxResponse> {
  const read = await readApprovalInbox(user);
  const logEntry: ApprovalInboxRow[] = read.logEntry.map(({ request: r }) => ({
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
  const rc: ApprovalInboxRow[] = read.rc.map((r) => ({
    id: r.id,
    docCode: r.docCode,
    vendorName: r.vendorName,
    itemCode: r.itemCode,
    itemName: r.itemName,
    docQty: r.docQty,
    docAmount: r.docAmount,
    createdByName: r.createdByName,
    createdAt: r.createdAt,
    navPage: r.navPage,
  }));
  return {
    counts: { pr: 0, po: read.po.length, logEntry: read.logEntryCount, rc: rc.length },
    pr: [],
    po: read.po,
    logEntry,
    rc,
  };
}
