import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

export async function soQcStatusRoutes(app: FastifyInstance): Promise<void> {
  app.get('/so-qc-status', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.listSoForQc(req.user);
  });

  app.get('/so-qc-status/:soId', async (req) => {
    if (!req.user) throw new AuthenticationError();
    const { soId } = req.params as { soId: string };
    return service.getSoQcStatus(soId, req.user);
  });
}
