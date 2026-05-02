import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import {
  createPurchaseRequestInputSchema,
  listPurchaseRequestsQuerySchema,
  updatePurchaseRequestInputSchema,
} from './schema';
import * as service from './service';

const idParamSchema = z.object({ id: z.string().uuid() });

export async function purchaseRequestsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/purchase-requests', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listPurchaseRequestsQuerySchema.parse(req.query);
    return service.listPurchaseRequests(query, req.user);
  });

  app.get('/purchase-requests/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getPurchaseRequest(id, req.user);
  });

  app.post('/purchase-requests', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const body = createPurchaseRequestInputSchema.parse(req.body);
    const detail = await service.createPurchaseRequest(body, req.user);
    reply.code(201);
    return detail;
  });

  app.patch('/purchase-requests/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const body = updatePurchaseRequestInputSchema.parse(req.body);
    return service.updatePurchaseRequest(id, body, req.user);
  });

  app.delete('/purchase-requests/:id', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    await service.softDeletePurchaseRequest(id, req.user);
    reply.code(204);
    return null;
  });
}
