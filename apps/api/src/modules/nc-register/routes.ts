import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import {
  createNcRegisterInputSchema,
  listNcRegisterQuerySchema,
  updateNcRegisterInputSchema,
} from './schema';
import * as service from './service';

const idParamSchema = z.object({ id: z.string().uuid() });

export async function ncRegisterRoutes(app: FastifyInstance): Promise<void> {
  app.get('/nc-register', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listNcRegisterQuerySchema.parse(req.query);
    return service.listNcRegister(query, req.user);
  });

  app.get('/nc-register/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getNcRegister(id, req.user);
  });

  app.post('/nc-register', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const body = createNcRegisterInputSchema.parse(req.body);
    const detail = await service.createNcRegister(body, req.user);
    reply.code(201);
    return detail;
  });

  app.patch('/nc-register/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const body = updateNcRegisterInputSchema.parse(req.body);
    return service.updateNcRegister(id, body, req.user);
  });

  app.delete('/nc-register/:id', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    await service.softDeleteNcRegister(id, req.user);
    reply.code(204);
    return null;
  });
}
