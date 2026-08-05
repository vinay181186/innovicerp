import {
  cancelPartyMaterialIssueInputSchema,
  createPartyMaterialIssueInputSchema,
} from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

const idParam = z.object({ id: z.string().uuid() });

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

  // ADR-103 — reverse a wrong issue (puts the qty back on party stock).
  app.post('/party-material-issues/:id/cancel', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParam.parse(req.params);
    const { reason } = cancelPartyMaterialIssueInputSchema.parse(req.body);
    return service.cancelPartyMaterialIssue(id, reason, req.user);
  });
}
