import {
  createStoreIssueInputSchema,
  listStoreIssuesQuerySchema,
  reverseStoreIssueInputSchema,
} from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

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

  app.post('/store-issues', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const input = createStoreIssueInputSchema.parse(req.body);
    const result = await service.createStoreIssue(input, req.user);
    reply.code(201);
    return result;
  });

  app.post('/store-issues/:id/reverse', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const input = reverseStoreIssueInputSchema.parse(req.body);
    return service.reverseStoreIssue(id, input, req.user);
  });
}
