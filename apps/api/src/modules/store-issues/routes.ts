import {
  createStoreIssueInputSchema,
  listStoreIssuesQuerySchema,
} from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

export async function storeIssuesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/store-issues', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listStoreIssuesQuerySchema.parse(req.query);
    return service.listStoreIssues(query, req.user);
  });

  app.post('/store-issues', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const input = createStoreIssueInputSchema.parse(req.body);
    const result = await service.createStoreIssue(input, req.user);
    reply.code(201);
    return result;
  });
}
