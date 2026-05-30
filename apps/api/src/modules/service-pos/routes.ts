import type { FastifyInstance } from 'fastify';
import {
  createServicePoInputSchema,
  listServicePosQuerySchema,
  updateServicePoInputSchema,
} from '@innovic/shared';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

const idParamSchema = z.object({ id: z.string().uuid() });

export async function servicePosRoutes(app: FastifyInstance): Promise<void> {
  app.get('/service-pos', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listServicePosQuerySchema.parse(req.query);
    return service.listServicePos(query, req.user);
  });

  app.get('/service-pos/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getServicePo(id, req.user);
  });

  app.post('/service-pos', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const body = createServicePoInputSchema.parse(req.body);
    const result = await service.createServicePo(body, req.user);
    reply.code(201);
    return result;
  });

  app.patch('/service-pos/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const body = updateServicePoInputSchema.parse(req.body);
    return service.updateServicePo(id, body, req.user);
  });

  app.post('/service-pos/:id/approve', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.approveServicePo(id, req.user);
  });

  app.delete('/service-pos/:id', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    await service.softDeleteServicePo(id, req.user);
    reply.code(204);
    return null;
  });
}
