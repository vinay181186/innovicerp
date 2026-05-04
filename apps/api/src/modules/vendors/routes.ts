import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import { createVendorInputSchema, listVendorsQuerySchema, updateVendorInputSchema } from './schema';
import * as service from './service';

const idParamSchema = z.object({ id: z.string().uuid() });

export async function vendorsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/vendors', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listVendorsQuerySchema.parse(req.query);
    return service.listVendors(query, req.user);
  });

  app.get('/vendors/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getVendor(id, req.user);
  });

  app.post('/vendors', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const body = createVendorInputSchema.parse(req.body);
    const row = await service.createVendor(body, req.user);
    reply.code(201);
    return row;
  });

  app.patch('/vendors/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const body = updateVendorInputSchema.parse(req.body);
    return service.updateVendor(id, body, req.user);
  });

  app.delete('/vendors/:id', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    await service.softDeleteVendor(id, req.user);
    reply.code(204);
    return null;
  });
}
