import { activityReasonSchema } from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import {
  createRouteCardInputSchema,
  listRouteCardsQuerySchema,
  updateRouteCardInputSchema,
} from './schema';
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
    return service.updateRouteCard(id, input, req.user);
  });

  app.delete('/route-cards/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const { reason } = deleteRouteCardBodySchema.parse(req.body);
    return service.softDeleteRouteCard(id, req.user, reason ?? null);
  });
}
