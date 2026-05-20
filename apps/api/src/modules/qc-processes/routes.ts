import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import {
  createQcProcessInputSchema,
  listQcProcessesQuerySchema,
  updateQcProcessInputSchema,
} from './schema';
import * as service from './service';

const idParamSchema = z.object({ id: z.string().uuid() });

export async function qcProcessesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/qc-processes', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listQcProcessesQuerySchema.parse(req.query);
    return service.listQcProcesses(query, req.user);
  });

  app.get('/qc-processes/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getQcProcess(id, req.user);
  });

  app.post('/qc-processes', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const body = createQcProcessInputSchema.parse(req.body);
    const row = await service.createQcProcess(body, req.user);
    reply.code(201);
    return row;
  });

  app.patch('/qc-processes/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const body = updateQcProcessInputSchema.parse(req.body);
    return service.updateQcProcess(id, body, req.user);
  });

  app.delete('/qc-processes/:id', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    await service.softDeleteQcProcess(id, req.user);
    reply.code(204);
    return null;
  });
}
