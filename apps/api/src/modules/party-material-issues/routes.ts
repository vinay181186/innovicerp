import {
  cancelPartyMaterialIssueInputSchema,
  createPartyMaterialIssueInputSchema,
  listPartyMaterialIssuesQuerySchema,
  returnPartyMaterialIssueToStoreInputSchema,
} from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import { requestCancel } from '../cancel-requests/service';
import * as service from './service';

const idParam = z.object({ id: z.string().uuid() });

export async function partyMaterialIssuesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/party-material-issues', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listPartyMaterialIssuesQuerySchema.parse(req.query);
    return service.listPartyMaterialIssues(query, req.user);
  });

  // ADR-203: issuable qty for one Job Card (static path before any :id route).
  app.get('/party-material-issues/issuable', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { jobCardId } = z.object({ jobCardId: z.string().uuid() }).parse(req.query);
    return service.getIssuableForJobCard(jobCardId, req.user);
  });

  app.post('/party-material-issues', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const input = createPartyMaterialIssueInputSchema.parse(req.body);
    const result = await service.createPartyMaterialIssue(input, req.user);
    reply.code(201);
    return result;
  });

  // ADR-235: no direct cancel any more — this sends a Cancel Request (the
  // Approve-tick holder approves it) and returns the CancelRequestResult.
  app.post('/party-material-issues/:id/cancel', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParam.parse(req.params);
    const { reason } = cancelPartyMaterialIssueInputSchema.parse(req.body);
    return requestCancel('party_material_issue', id, { reason, approveNow: false }, req.user);
  });

  // ADR-203 - put unused pieces back from the Job Card into the register.
  app.post('/party-material-issues/:id/return-to-store', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParam.parse(req.params);
    const input = returnPartyMaterialIssueToStoreInputSchema.parse(req.body);
    return service.returnPartyMaterialIssueToStore(id, input, req.user);
  });
}
