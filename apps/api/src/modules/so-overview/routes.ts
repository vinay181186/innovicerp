import { soOverviewQuerySchema } from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

export async function soOverviewRoutes(app: FastifyInstance): Promise<void> {
  app.get('/so-overview', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = soOverviewQuerySchema.parse(req.query);
    return service.getSoOverview(req.user, query);
  });
}
