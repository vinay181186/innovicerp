import {
  createStoreIssueInputSchema,
  listStoreIssuesQuerySchema,
  returnStoreIssueInputSchema,
  reverseStoreIssueInputSchema,
} from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import { requestCancel } from '../cancel-requests/service';
import * as service from './service';

const idParams = z.object({ id: z.string().uuid() });

export async function storeIssuesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/store-issues', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listStoreIssuesQuerySchema.parse(req.query);
    return service.listStoreIssues(query, req.user);
  });

  app.get('/store-issues/next-code', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getNextStoreIssueCode(req.user);
  });

  app.get('/store-issues/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParams.parse(req.params);
    return service.getStoreIssue(id, req.user);
  });

  app.post('/store-issues', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const input = createStoreIssueInputSchema.parse(req.body);
    const result = await service.createStoreIssue(input, req.user);
    reply.code(201);
    return result;
  });

  app.post('/store-issues/:id/returns', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParams.parse(req.params);
    const input = returnStoreIssueInputSchema.parse(req.body);
    const result = await service.returnStoreIssue(id, input, req.user);
    reply.code(201);
    return result;
  });

  // ADR-235: Cancel of an Item Issue (the full reversal) is a Cancel Request —
  // the Approve-tick holder approves it. Returns the CancelRequestResult.
  app.post('/store-issues/:id/reverse', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParams.parse(req.params);
    const { reason } = reverseStoreIssueInputSchema.parse(req.body);
    return requestCancel('store_issue', id, { reason, approveNow: false }, req.user);
  });
}
