import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import {
  createMachineInputSchema,
  listMachinesQuerySchema,
  updateMachineInputSchema,
} from './schema';
import * as service from './service';

const idParamSchema = z.object({ id: z.string().uuid() });

export async function machinesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/machines', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listMachinesQuerySchema.parse(req.query);
    return service.listMachines(query, req.user);
  });

  app.get('/machines/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getMachine(id, req.user);
  });

  app.post('/machines', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const body = createMachineInputSchema.parse(req.body);
    const row = await service.createMachine(body, req.user);
    reply.code(201);
    return row;
  });

  app.patch('/machines/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const body = updateMachineInputSchema.parse(req.body);
    return service.updateMachine(id, body, req.user);
  });

  app.delete('/machines/:id', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    await service.softDeleteMachine(id, req.user);
    reply.code(204);
    return null;
  });
}
