import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import { approvalHistoryListQuerySchema, approvalInboxListQuerySchema } from '@innovic/shared';
import { listApprovalHistory } from './history';
import { listApprovalInboxSection } from './inbox-list';
import * as service from './service';
import { getWaitingApprovals } from './waiting';

export async function approvalsRoutes(app: FastifyInstance): Promise<void> {
  // What is waiting for the caller to approve (ADR-190). Read-only.
  app.get('/approvals/inbox', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getApprovalInbox(req.user);
  });

  // One section (PR / PO) a page at a time, searched + sorted on the server (ADR-201).
  app.get('/approvals/inbox/list', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return listApprovalInboxSection(approvalInboxListQuerySchema.parse(req.query), req.user);
  });

  // ADR-265 — everything waiting for the caller, every type in one list. Read-only;
  // deciding stays on each type's own endpoint.
  app.get('/approvals/waiting', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return getWaitingApprovals(req.user);
  });

  // ADR-265 — past approve / reject decisions on the types the caller may decide.
  app.get('/approvals/history', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return listApprovalHistory(approvalHistoryListQuerySchema.parse(req.query), req.user);
  });
}
