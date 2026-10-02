import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import { approvalInboxListQuerySchema } from '@innovic/shared';
import { listApprovalInboxSection } from './inbox-list';
import * as service from './service';

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
}
