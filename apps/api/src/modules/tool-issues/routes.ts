import {
  createToolIssueInputSchema,
  listToolIssuesQuerySchema,
  recordToolReturnInputSchema,
} from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

const idParamSchema = z.object({ id: z.string().uuid() });

export async function toolIssuesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/tool-issues', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listToolIssuesQuerySchema.parse(req.query);
    return service.listToolIssues(query, req.user);
  });

  app.get('/tool-issues/next-code', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getNextToolIssueCode(req.user);
  });

  app.post('/tool-issues', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const input = createToolIssueInputSchema.parse(req.body);
    const result = await service.createToolIssue(input, req.user);
    reply.code(201);
    return result;
  });

  app.post('/tool-issues/:id/return', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const input = recordToolReturnInputSchema.parse(req.body);
    return service.recordToolReturn(id, input, req.user);
  });
}
