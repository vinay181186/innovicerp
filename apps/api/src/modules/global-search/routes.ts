import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import { globalSearchQuerySchema } from './schema';
import * as service from './service';

export async function globalSearchRoutes(app: FastifyInstance): Promise<void> {
  app.get('/global-search', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = globalSearchQuerySchema.parse(req.query);
    return service.globalSearch(query, req.user);
  });
}
