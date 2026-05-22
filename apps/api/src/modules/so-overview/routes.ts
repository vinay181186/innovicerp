import { soOverviewQuerySchema } from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

const detailParamsSchema = z.object({ id: z.string().uuid() });

export async function soOverviewRoutes(app: FastifyInstance): Promise<void> {
  app.get('/so-overview', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = soOverviewQuerySchema.parse(req.query);
    return service.getSoOverview(req.user, query);
  });

  app.get('/so-overview/:id/detail', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { id } = detailParamsSchema.parse(req.params);
    return service.getSoOverviewDetail(id, req.user);
  });
}
