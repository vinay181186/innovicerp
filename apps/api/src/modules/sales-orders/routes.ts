import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import {
  createSalesOrderInputSchema,
  listSalesOrdersQuerySchema,
  updateSalesOrderInputSchema,
} from './schema';
import * as service from './service';

const idParamSchema = z.object({ id: z.string().uuid() });

export async function salesOrdersRoutes(app: FastifyInstance): Promise<void> {
  app.get('/sales-orders', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listSalesOrdersQuerySchema.parse(req.query);
    return service.listSalesOrders(query, req.user);
  });

  app.get('/sales-orders/next-code', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getNextSoCode(req.user);
  });

  app.get('/sales-orders/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getSalesOrder(id, req.user);
  });

  app.post('/sales-orders', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const body = createSalesOrderInputSchema.parse(req.body);
    const detail = await service.createSalesOrder(body, req.user);
    reply.code(201);
    return detail;
  });

  app.patch('/sales-orders/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const body = updateSalesOrderInputSchema.parse(req.body);
    return service.updateSalesOrder(id, body, req.user);
  });

  app.delete('/sales-orders/:id', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    await service.softDeleteSalesOrder(id, req.user);
    reply.code(204);
    return null;
  });
}
