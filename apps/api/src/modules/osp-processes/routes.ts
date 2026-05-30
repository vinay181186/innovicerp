import type { FastifyInstance } from 'fastify';
import { ospProcessInputSchema } from '@innovic/shared';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

const idParamSchema = z.object({ id: z.string().uuid() });

export async function ospProcessesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/osp-processes', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.listOspProcesses(req.user);
  });

  app.post('/osp-processes', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const body = ospProcessInputSchema.parse(req.body);
    return service.createOspProcess(body, req.user);
  });

  app.get('/osp-processes/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getOspProcess(id, req.user);
  });

  app.patch('/osp-processes/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const body = ospProcessInputSchema.parse(req.body);
    return service.updateOspProcess(id, body, req.user);
  });

  app.delete('/osp-processes/:id', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    await service.softDeleteOspProcess(id, req.user);
    reply.code(204);
    return null;
  });
}
