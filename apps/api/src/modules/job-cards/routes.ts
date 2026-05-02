import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import { listJobCardsQuerySchema } from './schema';
import * as service from './service';

const idParamSchema = z.object({ id: z.string().uuid() });

export async function jobCardsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/job-cards', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listJobCardsQuerySchema.parse(req.query);
    return service.listJobCards(query, req.user);
  });

  app.get('/job-cards/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = idParamSchema.parse(req.params);
    return service.getJobCard(id, req.user);
  });
}
