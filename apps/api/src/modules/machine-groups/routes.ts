import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import {
  createMachineGroupInputSchema,
  listMachineGroupsQuerySchema,
  updateMachineGroupInputSchema,
} from './schema';
import * as service from './service';

const idParamSchema = z.object({ id: z.string().uuid() });

export async function machineGroupsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/machine-groups', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listMachineGroupsQuerySchema.parse(req.query);
    return service.listMachineGroups(query, req.user);
  });

  app.get('/machine-groups/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getMachineGroup(id, req.user);
  });

  app.post('/machine-groups', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const body = createMachineGroupInputSchema.parse(req.body);
    const row = await service.createMachineGroup(body, req.user);
    reply.code(201);
    return row;
  });

  app.patch('/machine-groups/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const body = updateMachineGroupInputSchema.parse(req.body);
    return service.updateMachineGroup(id, body, req.user);
  });

  app.delete('/machine-groups/:id', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    await service.softDeleteMachineGroup(id, req.user);
    reply.code(204);
    return null;
  });
}
