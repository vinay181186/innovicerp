import {
  createJwDcInwardInputSchema,
  createJwDcOutwardInputSchema,
  listJwDcInwardQuerySchema,
  listJwDcOutwardQuerySchema,
} from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

const idParam = z.object({ id: z.string().uuid() });
const poIdParam = z.object({ poId: z.string().uuid() });

export async function jwDcRoutes(app: FastifyInstance): Promise<void> {
  app.get('/jw-dc/outward', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listJwDcOutwardQuerySchema.parse(req.query);
    return service.listJwDcOutward(query, req.user);
  });

  app.get('/jw-dc/outward/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParam.parse(req.params);
    return service.getJwDcOutwardDetail(id, req.user);
  });

  app.get('/jw-dc/:id/related', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParam.parse(req.params);
    return service.getJwDcRelated(id, req.user);
  });

  app.get('/jw-dc/po-lines/:poId', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { poId } = poIdParam.parse(req.params);
    return service.getJwDcPoLines(poId, req.user);
  });

  app.post('/jw-dc/outward', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const input = createJwDcOutwardInputSchema.parse(req.body);
    const result = await service.createJwDcOutward(input, req.user);
    reply.code(201);
    return result;
  });

  app.get('/jw-dc/inward', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listJwDcInwardQuerySchema.parse(req.query);
    return service.listJwDcInward(query, req.user);
  });

  app.post('/jw-dc/inward', async (req, reply) => {
    if (!req.user) throw new AuthenticationError();
    const input = createJwDcInwardInputSchema.parse(req.body);
    const result = await service.createJwDcInward(input, req.user);
    reply.code(201);
    return result;
  });
}
