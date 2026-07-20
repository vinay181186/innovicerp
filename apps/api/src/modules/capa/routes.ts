import { createCapaInputSchema, updateCapaInputSchema } from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

export async function capaRoutes(app: FastifyInstance): Promise<void> {
  app.get('/capa', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.listCapa(req.user);
  });

  app.get('/capa/next-code', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getNextCapaCode(req.user);
  });

  app.post('/capa', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const input = createCapaInputSchema.parse(req.body);
    return service.createCapa(input, req.user);
  });

  app.patch('/capa/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = req.params as { id: string };
    const input = updateCapaInputSchema.parse(req.body);
    return service.updateCapa(id, input, req.user);
  });
}
