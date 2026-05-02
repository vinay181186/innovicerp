import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import {
  createJobWorkOrderInputSchema,
  listJobWorkOrdersQuerySchema,
  updateJobWorkOrderInputSchema,
} from './schema';
import * as service from './service';

const idParamSchema = z.object({ id: z.string().uuid() });

export async function jobWorkOrdersRoutes(app: FastifyInstance): Promise<void> {
  app.get('/job-work-orders', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listJobWorkOrdersQuerySchema.parse(req.query);
    return service.listJobWorkOrders(query, req.user);
  });

  app.get('/job-work-orders/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getJobWorkOrder(id, req.user);
  });

  app.post('/job-work-orders', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const body = createJobWorkOrderInputSchema.parse(req.body);
    const detail = await service.createJobWorkOrder(body, req.user);
    reply.code(201);
    return detail;
  });

  app.patch('/job-work-orders/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const body = updateJobWorkOrderInputSchema.parse(req.body);
    return service.updateJobWorkOrder(id, body, req.user);
  });

  app.delete('/job-work-orders/:id', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    await service.softDeleteJobWorkOrder(id, req.user);
    reply.code(204);
    return null;
  });
}
