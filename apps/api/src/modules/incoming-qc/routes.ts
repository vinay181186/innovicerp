import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

export async function incomingQcRoutes(app: FastifyInstance): Promise<void> {
  app.get('/incoming-qc', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.getIncomingQc(req.user);
  });
}
