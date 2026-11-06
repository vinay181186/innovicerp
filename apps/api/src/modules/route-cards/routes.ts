import {
  activityReasonSchema,
  approveRouteCardInputSchema,
  rejectRouteCardInputSchema,
  submitRouteCardInputSchema,
} from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import {
  createRouteCardInputSchema,
  listRouteCardsQuerySchema,
  updateRouteCardInputSchema,
} from './schema';
import { approveRouteCard, rejectRouteCard, submitRouteCard } from './approval';
import { getRouteCardRelated } from './related';
import * as service from './service';

const idParamSchema = z.object({ id: z.string().uuid() });

// ADR-197 — why the card went to Trash. Optional at the door (an older screen
// sends no body); the Route Card screens always ask for it.
const deleteRouteCardBodySchema = z
  .object({ reason: activityReasonSchema.optional() })
  .nullish()
  .transform((b) => b ?? {});

export async function routeCardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/route-cards', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listRouteCardsQuerySchema.parse(req.query);
    return service.listRouteCards(query, req.user);
  });

  app.get('/route-cards/next-code', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getNextRouteCardCode(req.user);
  });

  app.get('/route-cards/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getRouteCard(id, req.user);
  });

  app.get('/route-cards/:id/related', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return getRouteCardRelated(id, req.user);
  });

  app.post('/route-cards', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const input = createRouteCardInputSchema.parse(req.body);
    const detail = await service.createRouteCard(input, req.user);
    reply.code(201);
    return detail;
  });

  app.put('/route-cards/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const input = updateRouteCardInputSchema.parse(req.body);
    // ADR-249 Step B2 — staged for approval when the gate is on, else saved.
    return service.updateRouteCardOrStage(id, input, req.user);
  });

  // ADR-253 — a NEW card waits for approval. Approve tick on Route Card Master.
  app.post('/route-cards/:id/approve', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const input = approveRouteCardInputSchema.parse(req.body ?? {});
    return approveRouteCard(id, input, req.user);
  });

  app.post('/route-cards/:id/reject', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const input = rejectRouteCardInputSchema.parse(req.body ?? {});
    return rejectRouteCard(id, input, req.user);
  });

  // ADR-277 — Submit for Approval: a Draft or Rejected card → Pending Approval.
  app.post('/route-cards/:id/submit', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const input = submitRouteCardInputSchema.parse(req.body ?? {});
    return submitRouteCard(id, input, req.user);
  });

  app.delete('/route-cards/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const { reason } = deleteRouteCardBodySchema.parse(req.body);
    return service.softDeleteRouteCard(id, req.user, reason ?? null);
  });
}
