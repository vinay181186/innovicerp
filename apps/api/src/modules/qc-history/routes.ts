import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

export async function qcHistoryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/qc-history', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getQcHistory(req.user);
  });
}
