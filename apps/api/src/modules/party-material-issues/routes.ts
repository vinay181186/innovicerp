import { createPartyMaterialIssueInputSchema } from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

export async function partyMaterialIssuesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/party-material-issues', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.listPartyMaterialIssues(req.user);
  });

  app.post('/party-material-issues', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const input = createPartyMaterialIssueInputSchema.parse(req.body);
    const result = await service.createPartyMaterialIssue(input, req.user);
    reply.code(201);
    return result;
  });
}
