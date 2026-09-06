import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import {
  createTpiMasterInputSchema,
  listTpiMastersQuerySchema,
  updateTpiMasterInputSchema,
} from './schema';
import * as service from './service';

const idParamSchema = z.object({ id: z.string().uuid() });

export async function tpiMastersRoutes(app: FastifyInstance): Promise<void> {
  app.get('/tpi-masters', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listTpiMastersQuerySchema.parse(req.query);
    return service.listTpiMasters(query, req.user);
  });

  app.get('/tpi-masters/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getTpiMaster(id, req.user);
  });

  app.post('/tpi-masters', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const body = createTpiMasterInputSchema.parse(req.body);
    const row = await service.createTpiMaster(body, req.user);
    reply.code(201);
    return row;
  });

  app.patch('/tpi-masters/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const body = updateTpiMasterInputSchema.parse(req.body);
    return service.updateTpiMaster(id, body, req.user);
  });

  app.delete('/tpi-masters/:id', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    await service.softDeleteTpiMaster(id, req.user);
    reply.code(204);
    return null;
  });
}
