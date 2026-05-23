import { listProdSoQuerySchema } from '@innovic/shared';
import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

export async function prodSoListRoutes(app: FastifyInstance): Promise<void> {
  app.get('/prod-so-list', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const query = listProdSoQuerySchema.parse(req.query);
    return service.listProdSo(query, req.user);
  });
}
