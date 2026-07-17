import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import {
  jobCardCreateInputSchema,
  jobCardUpdateInputSchema,
  listJobCardsQuerySchema,
} from './schema';
import * as service from './service';

const idParamSchema = z.object({ id: z.string().uuid() });

export async function jobCardsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/job-cards', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listJobCardsQuerySchema.parse(req.query);
    return service.listJobCards(query, req.user);
  });

  app.post('/job-cards', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const body = jobCardCreateInputSchema.parse(req.body);
    const created = await service.createJobCard(body, req.user);
    reply.code(201);
    return created;
  });

  // Static route registered before the parametric :id route.
  app.get('/job-cards/source-options', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.listJobCardSourceOptions(req.user);
  });

  app.get('/job-cards/:id/edit', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getJobCardEditModel(id, req.user);
  });

  // JC Status extras: QC docs, per-op machine name + tool details, and the
  // merged completion feed with a real total (parity: viewJCStatus L11020).
  app.get('/job-cards/:id/status', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getJobCardStatusExtras(id, req.user);
  });

  app.get('/job-cards/:id/related', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getJobCardRelated(id, req.user);
  });

  app.get('/job-cards/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getJobCard(id, req.user);
  });

  app.patch('/job-cards/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    const body = jobCardUpdateInputSchema.parse(req.body);
    return service.updateJobCard(id, body, req.user);
  });

  app.delete('/job-cards/:id', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    await service.deleteJobCard(id, req.user);
    reply.code(204);
    return null;
  });
}
