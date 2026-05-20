import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import { listUsersQuerySchema, updateUserInputSchema } from './schema';
import * as service from './service';

const idParamSchema = z.object({ id: z.string().uuid() });

export async function usersRoutes(app: FastifyInstance): Promise<void> {
  app.get('/users', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listUsersQuerySchema.parse(req.query);
    return service.listUsers(query, req.user);
  });

  app.get('/users/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getUser(id, req.user);
  });

  app.patch('/users/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const body = updateUserInputSchema.parse(req.body);
    return service.updateUser(id, body, req.user);
  });

  app.delete('/users/:id', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    await service.softDeleteUser(id, req.user);
    reply.code(204);
    return null;
  });
}
