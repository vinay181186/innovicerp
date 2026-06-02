import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

export async function soCostingRoutes(app: FastifyInstance): Promise<void> {
  app.get('/so-costing', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.listSoCosting(req.user);
  });

  app.get<{ Params: { id: string } }>('/so-costing/:id', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getSoCostingDetail(req.params.id, req.user);
  });
}
