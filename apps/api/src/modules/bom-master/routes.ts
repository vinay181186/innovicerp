import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import {
  createBomMasterInputSchema,
  listBomMastersQuerySchema,
  updateBomMasterInputSchema,
} from './schema';
import * as service from './service';

const idParamSchema = z.object({ id: z.string().uuid() });

export async function bomMasterRoutes(app: FastifyInstance): Promise<void> {
  app.get('/bom-masters', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listBomMastersQuerySchema.parse(req.query);
    return service.listBomMasters(query, req.user);
  });

  app.get('/bom-masters/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getBomMaster(id, req.user);
  });

  app.post('/bom-masters', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const input = createBomMasterInputSchema.parse(req.body);
    const detail = await service.createBomMaster(input, req.user);
    reply.code(201);
    return detail;
  });

  app.put('/bom-masters/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const input = updateBomMasterInputSchema.parse(req.body);
    return service.updateBomMaster(id, input, req.user);
  });

  app.delete('/bom-masters/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.softDeleteBomMaster(id, req.user);
  });
}
