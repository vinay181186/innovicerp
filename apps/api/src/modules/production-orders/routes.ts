// Production Orders (ADR-170): Plan + Route Card + Target Date → Job Card;
// Close → stock credited once with the Job Card's finished qty.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import {
  closeProductionOrderInputSchema,
  createProductionOrderInputSchema,
  listProductionOrdersQuerySchema,
  reverseProductionOrderCloseInputSchema,
} from './schema';
import * as service from './service';

const idParamSchema = z.object({ id: z.string().uuid() });

export async function productionOrdersRoutes(app: FastifyInstance): Promise<void> {
  app.get('/production-orders', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listProductionOrdersQuerySchema.parse(req.query);
    return service.listProductionOrders(query, req.user);
  });

  // Declared before /:id so "next-code" is never parsed as an id.
  app.get('/production-orders/next-code', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getNextProductionOrderCode(req.user);
  });

  app.get('/production-orders/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getProductionOrder(id, req.user);
  });

  app.post('/production-orders', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const body = createProductionOrderInputSchema.parse(req.body);
    const row = await service.createProductionOrder(body, req.user);
    reply.code(201);
    return row;
  });

  app.post('/production-orders/:id/close', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const body = closeProductionOrderInputSchema.parse(req.body ?? {});
    return service.closeProductionOrder(id, body, req.user);
  });

  app.post('/production-orders/:id/reverse-close', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const body = reverseProductionOrderCloseInputSchema.parse(req.body ?? {});
    return service.reverseProductionOrderClose(id, body, req.user);
  });
}
