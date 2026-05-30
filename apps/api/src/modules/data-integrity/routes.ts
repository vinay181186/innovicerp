import type { FastifyInstance } from 'fastify';
import { AuthenticationError } from '../../lib/errors';
import * as service from './service';

export async function dataIntegrityRoutes(app: FastifyInstance): Promise<void> {
  app.get('/data-integrity', async (req) => {
    if (!req.user) throw new AuthenticationError();
    return service.runIntegrityCheck(req.user);
  });
}
