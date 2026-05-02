import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import {
  createPurchaseOrderFromPrInputSchema,
  createPurchaseOrderInputSchema,
  listPurchaseOrdersQuerySchema,
  updatePurchaseOrderInputSchema,
} from './schema';
import * as service from './service';

const idParamSchema = z.object({ id: z.string().uuid() });

export async function purchaseOrdersRoutes(app: FastifyInstance): Promise<void> {
  app.get('/purchase-orders', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listPurchaseOrdersQuerySchema.parse(req.query);
    return service.listPurchaseOrders(query, req.user);
  });

  app.get('/purchase-orders/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getPurchaseOrder(id, req.user);
  });

  app.post('/purchase-orders', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const body = createPurchaseOrderInputSchema.parse(req.body);
    const detail = await service.createPurchaseOrder(body, req.user);
    reply.code(201);
    return detail;
  });

  app.post('/purchase-orders/from-pr', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const body = createPurchaseOrderFromPrInputSchema.parse(req.body);
    const detail = await service.createPurchaseOrderFromPr(body, req.user);
    reply.code(201);
    return detail;
  });

  app.patch('/purchase-orders/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const body = updatePurchaseOrderInputSchema.parse(req.body);
    return service.updatePurchaseOrder(id, body, req.user);
  });

  app.delete('/purchase-orders/:id', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    await service.softDeletePurchaseOrder(id, req.user);
    reply.code(204);
    return null;
  });
}
