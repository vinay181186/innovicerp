import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import {
  bulkCreateMaterialSizesInputSchema,
  createMaterialSizeInputSchema,
  listMaterialSizesQuerySchema,
  updateMaterialSizeInputSchema,
} from './schema';
import * as service from './service';

const idParamSchema = z.object({ id: z.string().uuid() });

export async function materialSizesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/material-sizes', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listMaterialSizesQuerySchema.parse(req.query);
    return service.listMaterialSizes(query, req.user);
  });

  app.get('/material-sizes/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getMaterialSize(id, req.user);
  });

  app.post('/material-sizes', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const body = createMaterialSizeInputSchema.parse(req.body);
    const row = await service.createMaterialSize(body, req.user);
    reply.code(201);
    return row;
  });

  // Whole-sheet import. Declared BEFORE the ':id' routes so 'bulk' is never
  // captured as an :id param. Same gate and same per-row shape as the single
  // create — only the round trips differ.
  app.post('/material-sizes/bulk', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const body = bulkCreateMaterialSizesInputSchema.parse(req.body);
    const result = await service.createMaterialSizesBulk(body, req.user);
    reply.code(201);
    return result;
  });

  app.patch('/material-sizes/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const body = updateMaterialSizeInputSchema.parse(req.body);
    return service.updateMaterialSize(id, body, req.user);
  });

  app.delete('/material-sizes/:id', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    await service.softDeleteMaterialSize(id, req.user);
    reply.code(204);
    return null;
  });
}
