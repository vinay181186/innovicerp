import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

export async function approvalsRoutes(app: FastifyInstance): Promise<void> {
  // What is waiting for the caller to approve (ADR-189). Read-only.
  app.get('/approvals/inbox', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getApprovalInbox(req.user);
  });
}
