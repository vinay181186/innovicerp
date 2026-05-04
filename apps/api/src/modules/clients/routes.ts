import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import { createClientInputSchema, listClientsQuerySchema, updateClientInputSchema } from './schema';
import * as service from './service';

const idParamSchema = z.object({ id: z.string().uuid() });

export async function clientsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/clients', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listClientsQuerySchema.parse(req.query);
    return service.listClients(query, req.user);
  });

  app.get('/clients/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getClient(id, req.user);
  });

  app.post('/clients', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const body = createClientInputSchema.parse(req.body);
    const row = await service.createClient(body, req.user);
    reply.code(201);
    return row;
  });

  app.patch('/clients/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const body = updateClientInputSchema.parse(req.body);
    return service.updateClient(id, body, req.user);
  });

  app.delete('/clients/:id', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    await service.softDeleteClient(id, req.user);
    reply.code(204);
    return null;
  });
}
