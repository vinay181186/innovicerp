import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import {
  createCostCenterInputSchema,
  listCostCentersQuerySchema,
  updateCostCenterInputSchema,
} from './schema';
import * as service from './service';

const idParamSchema = z.object({ id: z.string().uuid() });

export async function costCentersRoutes(app: FastifyInstance): Promise<void> {
  app.get('/cost-centers', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listCostCentersQuerySchema.parse(req.query);
    return service.listCostCenters(query, req.user);
  });

  app.get('/cost-centers/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getCostCenter(id, req.user);
  });

  app.post('/cost-centers', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const body = createCostCenterInputSchema.parse(req.body);
    const row = await service.createCostCenter(body, req.user);
    reply.code(201);
    return row;
  });

  app.patch('/cost-centers/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const body = updateCostCenterInputSchema.parse(req.body);
    return service.updateCostCenter(id, body, req.user);
  });

  app.delete('/cost-centers/:id', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    await service.softDeleteCostCenter(id, req.user);
    reply.code(204);
    return null;
  });
}
