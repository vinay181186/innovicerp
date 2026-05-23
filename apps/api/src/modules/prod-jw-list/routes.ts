import { listProdJwQuerySchema } from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

export async function prodJwListRoutes(app: FastifyInstance): Promise<void> {
  app.get('/prod-jw-list', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listProdJwQuerySchema.parse(req.query);
    return service.listProdJw(query, req.user);
  });
}
